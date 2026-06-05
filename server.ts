console.log("Initializing API Server...");
import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();
console.log("Environment configuration loaded.");

// --- DEFENSIVE BOOT STRAPPING MECHANISM ---
import admin from 'firebase-admin';

function initializeGoogleServiceAccount() {
  try {
    const rawServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    
    if (!rawServiceAccount) {
      console.warn("⚠️ [Service Account] GOOGLE_SERVICE_ACCOUNT_KEY is missing. Firebase Admin integrations will not work until configured.");
      return;
    }

    // Defensively target both Vercel newline anomalies and literal slash escapes
    const sanitizedServiceAccount = rawServiceAccount
      .replace(/\\n/g, '\n')
      .trim();

    const serviceAccountObj = JSON.parse(sanitizedServiceAccount);
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = sanitizedServiceAccount; // Inject sanitized payload back to ENV
    
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountObj)
      });
    }

    console.log("🚀 [Service Account SDK] Initialized successfully with defensive regex parsing.");
  } catch (error: any) {
    console.error("🚨 [CRITICAL BACKEND CRASH] Service Account initialization failed on boot:", error.message);
    // Do not let the raw exception crash the worker thread silently, wrap it cleanly
  }
}
initializeGoogleServiceAccount();

// Rate Limit Defense: Dynamic Round-Robin API Key Manager
const GEMINI_KEYS = Object.keys(process.env)
  .filter(key => key.startsWith('GEMINI_API_KEY_'))
  .sort()
  .map(key => process.env[key])
  .filter(Boolean) as string[];

// Fallback to GEMINI_API_KEY if no numbered keys found
if (GEMINI_KEYS.length === 0 && process.env.GEMINI_API_KEY) {
    GEMINI_KEYS.push(process.env.GEMINI_API_KEY);
}

interface KeyState {
  index: number;
  key: string;
  maskedKey: string;
  status: "active" | "rate_limited" | "failed";
  errorCount: number;
  usageCount: number;
  lastUsed: Date | null;
}

const geminiKeyStates: KeyState[] = GEMINI_KEYS.map((key, i) => ({
  index: i + 1,
  key,
  maskedKey: `***${key.slice(-4)}`,
  status: "active",
  errorCount: 0,
  usageCount: 0,
  lastUsed: null
}));

let currentKeyIndex = 0;

interface RotationLog {
  id: string;
  timestamp: string;
  fromKeyIndex?: number;
  toKeyIndex: number;
  reason: string;
}

const rotationLogs: RotationLog[] = [];

function addRotationLog(log: Omit<RotationLog, "timestamp" | "id">) {
  rotationLogs.unshift({ 
    ...log, 
    id: Math.random().toString(36).substring(7),
    timestamp: new Date().toISOString() 
  });
  if (rotationLogs.length > 20) {
    rotationLogs.pop();
  }
}

function getGeminiClient(): { ai: any, state: KeyState } {
  if (geminiKeyStates.length === 0) {
    throw new Error("No Gemini API keys configured.");
  }
  
  // 1. Recover keys that have been rate limited for over 60 seconds
  const now = Date.now();
  geminiKeyStates.forEach(s => {
    if (s.status === "rate_limited" && s.lastUsed && (now - s.lastUsed.getTime() > 60000)) {
       s.status = "active";
       addRotationLog({
         toKeyIndex: s.index,
         reason: "Key auto-recovered from rate limit cooldown (60s)"
       });
    }
  });

  // 2. Find the next active key
  let attempts = 0;
  let selectedState: KeyState | null = null;
  let originalIndex = currentKeyIndex;
  let skippedIndices: number[] = [];
  
  while (attempts < geminiKeyStates.length) {
    const s = geminiKeyStates[currentKeyIndex];
    if (s.status !== "rate_limited") {
       selectedState = s;
       break;
    }
    skippedIndices.push(currentKeyIndex);
    currentKeyIndex = (currentKeyIndex + 1) % geminiKeyStates.length;
    attempts++;
  }

  // 3. Fallback: If all keys are rate limited, pick the one with the lowest usage or the one we are at
  if (!selectedState) {
    selectedState = geminiKeyStates[currentKeyIndex];
    addRotationLog({
       fromKeyIndex: originalIndex,
       toKeyIndex: selectedState.index,
       reason: "All keys rate limited. Forced fallback to current index."
    });
  } else if (skippedIndices.length > 0) {
    addRotationLog({
       fromKeyIndex: originalIndex,
       toKeyIndex: selectedState.index,
       reason: `Skipped rate-limited keys: [${skippedIndices.join(', ')}]`
    });
  } else {
    // Too noisy to log every single round-robin rotation, 
    // but if requested, we can log standard rotation:
    addRotationLog({
       fromKeyIndex: originalIndex,
       toKeyIndex: selectedState.index,
       reason: "Standard round-robin rotation"
    });
  }
  
  selectedState.usageCount++;
  selectedState.lastUsed = new Date();
  
  const ai = new GoogleGenAI({ apiKey: selectedState.key });
  currentKeyIndex = (currentKeyIndex + 1) % geminiKeyStates.length;
  
  return { ai, state: selectedState };
}

function handleGeminiError(state: KeyState, err: any) {
  state.errorCount++;
  const msg = err?.message || err?.toString() || "";
  if (err?.status === 429 || msg.includes("429") || msg.includes("quota") || msg.toLowerCase().includes("too many requests")) {
    state.status = "rate_limited";
    addRotationLog({
      toKeyIndex: state.index,
      reason: `Rate Limited / Quota Exceeded. Error: ${msg.substring(0, 100)}`
    });
  } else {
    state.status = "failed";
    addRotationLog({
      toKeyIndex: state.index,
      reason: `API Error. Msg: ${msg.substring(0, 100)}`
    });
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// JWT Helper for Firebase ID Tokens
  const decodeFirebaseToken = (token: string) => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], "base64").toString("utf8");
      return JSON.parse(payload);
    } catch (e) {
      return null;
    }
  };

  // Safe Firestore REST API fetch for securing user roles
  const getUserRoleFromFirestore = async (userId: string, idToken: string): Promise<string | null> => {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
    if (!projectId) {
      return null;
    }
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${idToken}`
        }
      });
      if (!res.ok) {
        console.error(`Firestore API check failed for user ${userId}:`, res.status);
        return null;
      }
      const docData = await res.json();
      return docData?.fields?.role?.stringValue || null;
    } catch (error) {
      console.error(`Error fetching user role from Firestore REST API:`, error);
      return null;
    }
  };

  // Rate Limit Defense: In-memory store for student AI cooldown tracking (5 seconds)
  const studentAICooldowns = new Map<string, number>();

  // Simple periodic cleanup to prevent memory growth (removes expired keys older than 1 minute)
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of studentAICooldowns.entries()) {
      if (now - timestamp > 60000) {
        studentAICooldowns.delete(key);
      }
    }
  }, 60000);

  // Authenticated Robust Cooldown Filter
  const aiCooldownMiddleware = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    let userId = req.headers["x-user-id"] as string;
    let userRole = req.headers["x-user-role"] as string;

    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.substring(7);
      const decoded = decodeFirebaseToken(idToken);
      if (decoded && decoded.user_id) {
        userId = decoded.user_id;
        // Authenticate token to fetch exact role from Firestore DB
        const dbRole = await getUserRoleFromFirestore(userId, idToken);
        if (dbRole) {
          userRole = dbRole;
        }
      }
    }

    if (userRole === "student" && userId) {
      const lastRequest = studentAICooldowns.get(userId);
      const now = Date.now();
      if (lastRequest && now - lastRequest < 5000) {
        const timeLeft = Math.ceil((5000 - (now - lastRequest)) / 1000);
        return res.status(429).json({
          error: `Bạn đang trong trạng thái đóng băng thời gian gọi AI (Cooldown 5 giây). Hãy đợi thêm ${timeLeft} giây nữa.`
        });
      }
      studentAICooldowns.set(userId, now);
    }
    next();
  };





  // Agent 2: Dynamic Router Agent (Deep Extract)
  app.post("/api/agent2/explain", aiCooldownMiddleware, async (req, res, next) => {
    let aiState: KeyState | null = null;
    try {
      const { term, definition, subject } = req.body;
      const { ai, state } = getGeminiClient();
      aiState = state;
      
      let prompt = "";
      if (subject === "english") {
        prompt = `Phân tích từ vựng tiếng Anh "${term}" (Định nghĩa: ${definition}). 
YÊU CẦU QUAN TRỌNG NHẤT:
1. ĐI THẲNG VÀO NỘI DUNG, TUYỆT ĐỐI KHÔNG xài lời chào hỏi xã giao (như "Chào bạn", "Đây là...").
2. Giải thích CỰC KỲ NGẮN GỌN, độ dài khoảng tối đa 100 chữ.
3. BẮT BUỘC kết thúc bằng 1 câu hỏi gợi mở để giúp học sinh mở rộng và phát triển kiến thức liên quan đến từ/cụm từ này.
Cấu trúc yêu cầu (có dùng emoji cho sinh động): 
- Ý nghĩa & Phiên âm.
- 1 Ví dụ minh hoạ thực tế.
- Câu hỏi gợi mở.
Chỉ trả ra nội dung phân tích (markdown).`;
      } else {
        prompt = `Phân tích khái niệm "${term}" (Định nghĩa: ${definition}).
YÊU CẦU QUAN TRỌNG NHẤT:
1. ĐI THẲNG VÀO NỘI DUNG, TUYỆT ĐỐI KHÔNG có lời chào hỏi xã giao hay câu mào đầu.
2. Dài khoảng tối đa 100 chữ, giải thích bản chất cốt lõi cực kỳ súc tích, dễ hiểu.
3. BẮT BUỘC kết thúc bằng 1 câu hỏi gợi mở liên quan đến ứng dụng hoặc tính chất cốt lõi để thúc đẩy học sinh tự suy nghĩ và phát triển kiến thức.
Bọc công thức Toán/Lý/Hóa bằng LaTeX (dấu $ hoặc $$). Chỉ trả ra nội dung (markdown).`;
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
        // removed responseMimeType since it's HTML/markdown
      });
      
      res.json({ result: response.text });
    } catch (error) {
      if (aiState) handleGeminiError(aiState, error);
      console.error("Agent 2 Error:", error);
      next(error);
    }
  });

  // Mock Exam Generator
  app.post("/api/exam/generate", aiCooldownMiddleware, async (req, res, next) => {
    let aiState: KeyState | null = null;
    try {
      const { decks, examType, count } = req.body;
      const { ai, state } = getGeminiClient();
      aiState = state;

      const contextData = JSON.stringify(decks.map((d: any) => ({
        deckId: d.id,
        deckTitle: d.title,
        cards: d.cards.map((c: any) => ({ cardId: c.id, front: c.front, back: c.back }))
      })));

      let prompt = `Bạn là một AI được thiết kế để tạo bài kiểm tra tự động từ các thẻ (flashcards) được cung cấp.
Dữ liệu Flashcards:
${contextData}

Yêu cầu: Hãy tạo một đề thi gồm ${count || 10} câu hỏi trắc nghiệm (Multiple Choice) từ các flashcards này. Mỗi thẻ có thể dùng để tạo câu hỏi về nội dung "front" hỏi "back" hoặc ngược lại, hoặc suy luận từ nội dung. Các lựa chọn sai (distractors) phải hợp lý và không quá dễ đoán. Đảo lộn vị trí đáp án đúng. Nghĩa là correctAnswerIndex có thể từ 0 đến 3 ngẫu nhiên.
BẮT BUỘC ĐỊNH DẠNG: Chỉ trả về ĐÚNG MỘT MẢNG JSON duy nhất, không markdown code block, không text thừa.
Định dạng JSON:
[
  {
    "cardId": "string - ID của thẻ đang được kiểm tra",
    "deckId": "string - ID của deck chứa thẻ này",
    "question": "string - Câu hỏi trắc nghiệm",
    "options": ["string", "string", "string", "string"],
    "correctAnswerIndex": number - Chỉ số của đáp án đúng (từ 0 đến 3),
    "explanation": "string - Giải thích ngắn vì sao lại chọn đáp án này"
  }
]`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.3
        }
      });

      res.json({ result: response.text });
    } catch (error) {
      if (aiState) handleGeminiError(aiState, error);
      console.error("Exam Generation Error:", error);
      next(error);
    }
  });

  // Agent 4: Convert Document to JSON (Streaming API + Chunking)
  app.post("/api/convert-document", aiCooldownMiddleware, async (req, res, next) => {
    try {
      const { fileData, mimeType } = req.body;

      if (!fileData) {
        return res.status(400).json({ error: true, message: "Không tìm thấy dữ liệu file", path: req.originalUrl });
      }

      const base64Data = fileData.split(',').pop() || fileData;

      // Start streaming response to prevent timeout
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

      res.write(JSON.stringify({ status: "Đang đọc nội dung gốc từ file..." }) + "\n");
      
      let aiState: KeyState | null = null;
      let aiClient: any = null;
      let rawText = "";
      
      try {
         const { ai, state } = getGeminiClient();
         aiClient = ai;
         aiState = state;
         const extractRes = await ai.models.generateContent({
             model: "gemini-2.5-flash",
             contents: [
                { text: "Extract ALL text from this document comprehensively and literally. Do not summarize or explain." },
                { inlineData: { data: base64Data, mimeType: mimeType || "application/pdf" } }
             ]
         });
         rawText = extractRes.text || "";
      } catch (err: any) {
         if (aiState) handleGeminiError(aiState, err);
         throw new Error("Lỗi khi đọc text từ file: " + err.message);
      }

      if (!rawText.trim()) {
         throw new Error("Không thể trích xuất văn bản từ file. Vui lòng đảm bảo file rõ nét và không bị mã hoá.");
      }

      // Chunk file roughly by chunks of ~3000 chars (around 500-1000 words depending on language)
      const MAX_CHUNK_LENGTH = 3000;
      const chunks = [];
      for (let i = 0; i < rawText.length; i += MAX_CHUNK_LENGTH) {
         chunks.push(rawText.substring(i, i + MAX_CHUNK_LENGTH));
      }

      res.write(JSON.stringify({ status: `Đã băm file thành ${chunks.length} chunks cục bộ. Bắt đầu xử lý AI...` }) + "\n");

      for (let i = 0; i < chunks.length; i++) {
         if (i > 0) {
            res.write(JSON.stringify({ status: `Đang delay 3s bảo vệ quota... (${i+1}/${chunks.length})` }) + "\n");
            await delay(3000);
         }

         const keyData = getGeminiClient(); // Round-robin rotate key
         aiClient = keyData.ai;
         aiState = keyData.state;

         res.write(JSON.stringify({ status: `Đang gửi Chunk ${i+1}/${chunks.length} cho AI bóc tách...` }) + "\n");

         const prompt = `[STRICT DETERMINISTIC MODE] You are a deterministic compiler. 
Extract flashcards from this text chunk into a JSON array of objects. 
Keys REQUIRED: "front" (Term/Concept), "back" (Definition/Translation/Context).
DO NOT wrap JSON in a markdown block. Return raw valid JSON array only. Return [] if none found.

TEXT CHUNK:
${chunks[i]}`;

         try {
            const chunkRes = await aiClient.models.generateContent({
               model: "gemini-2.5-flash",
               contents: [{ text: prompt }],
               config: {
                  responseMimeType: "application/json",
                  temperature: 0.1
               }
            });

            const chunkJsonText = (chunkRes.text || "").trim();
            if (chunkJsonText) {
               try {
                  const chunkArr = JSON.parse(chunkJsonText);
                  if (Array.isArray(chunkArr) && chunkArr.length > 0) {
                     res.write(JSON.stringify({ flashcards: chunkArr }) + "\n");
                  }
               } catch (parseErr) {
                  console.warn("Parse chunk JSON failed:", chunkJsonText);
               }
            }
         } catch (chunkErr: any) {
            if (aiState) handleGeminiError(aiState, chunkErr);
            console.error(`Lỗi Chunk ${i}:`, chunkErr);
            res.write(JSON.stringify({ status: `Warning: Bỏ qua Chunk ${i+1} do lỗi: ${chunkErr.message}` }) + "\n");
         }
      }

      res.write(JSON.stringify({ done: true, status: "Hoàn tất phân tích 100%!" }) + "\n");
      res.end();

    } catch (error: any) {
      console.error("Agent 4 Convert Document Error:", error);
      if (!res.headersSent) {
          next(error);
      } else {
          res.write(JSON.stringify({ error: true, message: error.message || "Lỗi xử lý luồng stream", path: req.originalUrl }) + "\n");
          res.end();
      }
    }
  });

  // AI Quick Lesson Plan Generator (Tạo Giáo Án Nhanh)
  app.post("/api/agent/lesson-plan", aiCooldownMiddleware, async (req, res, next) => {
    let aiState: KeyState | null = null;
    try {
      const { topic } = req.body;
      if (!topic) return res.status(400).json({ error: "No topic provided." });
      
      const { ai, state } = getGeminiClient();
      aiState = state;
      let prompt = `Bạn là một chuyên gia thiết kế chương trình giảng dạy (Instructional Designer).
Hãy tạo một giáo án học tập tối ưu cho chủ đề: "${topic}".
Giáo án cần đảm bảo đủ kiến thức sâu sắc, logic và dễ hiểu.
KHÔNG sử dụng Markdown code block. TRẢ VỀ ĐÚNG MỘT OBJECT JSON DUY NHẤT.

Định dạng JSON:
{
  "roadmap": [
    { "step": 1, "title": "Tên bài học", "description": "Mô tả ngắn gọn" }
  ],
  "concepts": [
    { "term": "Khái niệm", "definition": "Định nghĩa hoặc giải thích dễ hiểu" }
  ],
  "flashcards": [
    { "front": "Câu hỏi/Từ khóa", "back": "Câu trả lời/Định nghĩa", "subject": "${topic}" }
  ]
}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.3
        }
      });
      
      res.json({ result: response.text });
    } catch (error: any) {
      if (aiState) handleGeminiError(aiState, error);
      console.error("Lesson Plan Error:", error);
      next(error);
    }
  });

  // Agent 3: Socratic & Context-Aware Assistant
  app.post("/api/agent3/chat", aiCooldownMiddleware, async (req, res, next) => {
    let aiState: KeyState | null = null;
    try {
      const { message, history, context, mode, mcqData, difficulty, sessionId } = req.body;
      const { ai, state } = getGeminiClient();
      aiState = state;
      
      let systemPrompt = `Mày là Agent 3 - 'Socrates AI Coach', gia sư học tập chủ động. QUY TẮC BẮT BUỘC CỐT LÕI:
1. TRẢ LỜI NGẮN GỌN (Dưới 100 chữ). ĐI THẲNG VÀO NỘI DUNG, TUYỆT ĐỐI BỎ QUA MỌI LỜI CHÀO HỎI (VD: Không được nói "Chào em", "Chào bạn", "Tôi là...").
2. SOCRATIC METHOD: KHÔNG BAO GIỜ giải bài tập hộ hay cho đáp án trực tiếp. LUÔN KẾT THÚC BẰNG 1 CÂU HỎI GỢI MỞ để học sinh tự suy luận và phát triển kiến thức.
3. CONTEXT-AWARE: Mày sẽ nhận được Context ẩn. Tự động liên kết với Context đó để trả lời nếu học sinh hỏi trống không.
4. FORMATTING: Dùng LaTeX ($$, $) cho mọi công thức Toán/Lý/Hóa.`;

      if (mode === "quiz") {
          const diffLevel = difficulty || "medium";
          systemPrompt += `\n\nNhiệm vụ: Tạo một trò chơi trắc nghiệm 3 câu hỏi liên tiếp dựa trên context thẻ yếu được cung cấp. Cấp độ khó: ${diffLevel}. Đầu vào là yêu cầu người dùng: ${message}`;
          if (mcqData) {
            let difficultyGuidance = "Cấp độ trung bình.";
            if (diffLevel === "easy") difficultyGuidance = "Cấp độ dễ: Hỏi trực tiếp định nghĩa cơ bản, nhận biết trực tiếp.";
            if (diffLevel === "medium") difficultyGuidance = "Cấp độ trung bình: Yêu cầu hiểu sâu hơn, áp dụng cơ bản.";
            if (diffLevel === "hard") difficultyGuidance = "Cấp độ khó: Đánh đố, vận dụng cao, suy luận logic tổng hợp.";
            
            const mcqPrompt = `Tạo một bài Test 15 câu trắc nghiệm MCQ dựa trên danh sách các thẻ yếu sau đây. \nĐộ khó: ${difficultyGuidance}\nTrả về đúng 1 mảng JSON chứa các object: {"question": "...", "options": ["A...","B...","C...","D..."], "correctIndex": 0..3, "explanation": "..."}. KHÔNG trả về gì khác ngoài JSON.\nDữ liệu hổng kiến thức: ${JSON.stringify(mcqData)}`;
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: mcqPrompt,
                config: { responseMimeType: "application/json" }
            });
            return res.json({ result: response.text });
          }
      }
      
      const fullPrompt = `Ngữ cảnh ẩn (Hidden Context): ${context}\n\nHọc sinh: ${message}`;

      // Convert client history format to Gemini format
      let previousHistory: any[] = [];
      if (history && Array.isArray(history)) {
        previousHistory = history.map(msg => ({
          role: msg.role === "ai" ? "model" : "user",
          parts: [{ text: msg.text }]
        }));
      }

      const contents = [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "model", parts: [{ text: "Đã hiểu." }] },
          ...previousHistory,
          { role: "user", parts: [{ text: fullPrompt }] }
      ];

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents
      });

      const responseText = response.text || "";

      res.json({ result: responseText });
    } catch (error: any) {
      if (aiState) handleGeminiError(aiState, error);
      console.error("Agent 3 Error:", error);
      next(error);
    }
  });

  // Admin Keys Status Endpoint
  app.get("/api/admin/keys-status", (req, res) => {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.VITE_ADMIN_KEY) {
      return res.status(403).json({ error: "Thao tác không hợp lệ. Sai admin key." });
    }
    
    // reset rate_limited to active if passed 60s
    const now = Date.now();
    geminiKeyStates.forEach(state => {
       if (state.status === "rate_limited" && state.lastUsed && (now - state.lastUsed.getTime() > 60000)) {
           state.status = "active";
       }
    });

    res.json({
       totalKeys: geminiKeyStates.length,
       currentIndex: currentKeyIndex,
       logs: rotationLogs,
       keys: geminiKeyStates.map(s => ({
          index: s.index,
          maskedKey: s.maskedKey,
          status: s.status,
          usageCount: s.usageCount,
          errorCount: s.errorCount,
          lastUsed: s.lastUsed
       }))
    });
  });

  app.post("/api/daily-quest", express.json(), async (req, res, next) => {
    try {
      const { allCards } = req.body;
      if (!allCards || !Array.isArray(allCards)) {
        return res.status(400).json({ error: "Missing or invalid allCards array" });
      }

      const limit = 20;
      const newCardLimit = Math.floor(limit * 0.2); // 4 cards
      let reviewCardLimit = limit - newCardLimit;   // 16 cards

      const now = Date.now();

      // Process cards to determine New vs Review explicitly
      const processedCards = allCards.map(card => {
        const isNewCard = card.isNewCard !== undefined 
          ? card.isNewCard 
          : (card.repetitionCount === undefined || card.repetitionCount === 0);
        return { ...card, isNewCard };
      });

      const newCards = processedCards.filter(c => c.isNewCard);
      // Sort review cards so oldest due dates come first
      const reviewCards = processedCards
        .filter(c => !c.isNewCard && c.nextReviewDate && c.nextReviewDate <= now)
        .sort((a, b) => (a.nextReviewDate || 0) - (b.nextReviewDate || 0));

      let selectedNewCards = newCards.slice(0, newCardLimit);
      let selectedReviewCards = reviewCards.slice(0, reviewCardLimit);

      // Edge Cases: Not enough Review Cards
      if (selectedReviewCards.length < reviewCardLimit) {
         const missing = reviewCardLimit - selectedReviewCards.length;
         const additionalNewCards = newCards.slice(selectedNewCards.length, selectedNewCards.length + missing);
         selectedNewCards = [...selectedNewCards, ...additionalNewCards];
      }

      // Edge Cases: Not enough New Cards
      if (selectedNewCards.length < newCardLimit) {
         const missing = newCardLimit - selectedNewCards.length;
         const remainingReviewCards = reviewCards.slice(selectedReviewCards.length);
         const additionalReviewCards = remainingReviewCards.slice(0, missing);
         selectedReviewCards = [...selectedReviewCards, ...additionalReviewCards];
      }

      const combined = [...selectedNewCards, ...selectedReviewCards];
      
      // Shuffle combined sets
      for (let i = combined.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [combined[i], combined[j]] = [combined[j], combined[i]];
      }

      return res.json({ cards: combined });
    } catch (error: any) {
      console.error("Daily Quest Error:", error);
      next(error);
    }
  });

// Global Error Handling Middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global Error Caught:", err);
  
  const statusCode = err.status || 500;
  const isDev = process.env.NODE_ENV === "development";
  
  if (isDev) {
    res.status(statusCode).json({
      error: true,
      message: err.message || "Internal Server Error",
      path: req.originalUrl,
      stack: err.stack
    });
  } else {
    // Production: Hide stack trace details, show generic error if it's a 500 without a safe message
    res.status(statusCode).json({
      error: true,
      message: statusCode === 500 ? "Lỗi hệ thống máy chủ." : (err.message || "Lỗi không xác định"),
      path: req.originalUrl
    });
  }
});

// Vite middleware for development
async function setupViteAndStart() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

if (!process.env.VERCEL) {
  setupViteAndStart();
}

export default app;
