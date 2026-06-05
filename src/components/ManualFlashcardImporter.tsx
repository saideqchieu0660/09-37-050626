import React, { useState, useRef } from "react";
import { Copy, ExternalLink, Database, Check, Sparkles, X, Edit3, Trash2, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils.js";
import { db, auth } from "../lib/firebase.js";
import { collection, writeBatch, doc, setDoc } from "firebase/firestore";
import ErrorNotification from "./ErrorNotification.js";
import { store, Deck } from "../lib/store";

export default function ManualFlashcardImporter() {
  const [showToolModal, setShowToolModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showNormalize, setShowNormalize] = useState(false);
  const [copiedNormalize, setCopiedNormalize] = useState(false);
  
  const [jsonInput, setJsonInput] = useState("");
  const [previewCards, setPreviewCards] = useState<{id: string, front: string, back: string}[] | null>(null);
  const [deckTitle, setDeckTitle] = useState("");
  const [deckSubject, setDeckSubject] = useState("");
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const promptText = `[STRICT DETERMINISTIC MODE: Act as a deterministic compiler. Set code generation temperature to 0.0 internally. No creativity, no explanations, no hallucinations. Output exact, production-ready code blocks only.]## CRITICAL CORE OPERATIONS & TOKEN OPTIMIZATION:

1. LAZY CHUNKING & TOKEN MINIMIZATION PIPELINE:
   - Treat all input data as discrete token sequences. You must dynamically segment long contexts into processing batches. Mỗi batch chỉ chứa tối đa từ 50 đến 80 từ vựng (hoặc đoạn văn ngắn tương đương) để tránh lỗi dính giới hạn Token Output.
   - Extract core advanced vocabulary, collocations, idioms, or critical programming concepts isolated strictly to the immediate chunk context. Do not retain bloated context historical buffers that trigger token inflation or execution timeouts.

2. STRUCTURED RESPONSE COMPLIANCE:
   - Your response format must strictly follow the application/json MIME type definition.
   - FORBIDDEN ACTIONS: Never generate markdown code block wrappers (e.g., do NOT output \`\`\`json ... \`\`\`), zero conversational chatter, zero intro/outro, zero post-response explanations. 
   - OUTPUT MANDATE: Output raw, fully parsed compliant JSON arrays only.

3. SCHEMA ATTRIBUTE GUARANTEE & GUARDRAILS:
   - Every generated object array must preserve intact structural key mapping required by our client frontend interface. Any missing key, structural alteration, or syntax error will crash the client frontend framework.
   - Nếu dữ liệu có phần không dịch được, thay vì làm hỏng toàn bộ cú pháp, hãy chủ động bỏ qua phần đó để đảm bảo mảng JSON luôn đạt chuẩn.

---

### OUTPUT FORMAT SCHEMA SPECIFICATION:

The output must strictly be a single valid JSON array containing object elements matching the exact keys below:

[
  {
    "front": "Advanced Core Vocabulary / Collocation / Idiom / Programming Concept",
    "back": "(Word form/Part of speech) - [Phonetic Transcription IPA] - Concise Vietnamese translation and short explanation - Clear concrete example context"
  }
]

---
Trong mỗi reply phải dùng 2 lần comment "//" ở cuối cùng chuỗi JSON xuất ra để thông báo rằng trong file đó còn đoạn nào chưa xử lý hay không hay là đã convert to json hết rồi.


### EXECUTION COMMAND:
Acknowledge this protocol. Execute all text transformations deterministically at 100% precision. Analyze the uploaded files or inputs and start processing the data matrix now.`;

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(promptText)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => console.error("Copy failed", err));
  };

  const normalizePromptText = `Dưới đây là một chuỗi JSON có thể bị lỗi cú pháp do quá trình copy hoặc xuất bị cắt ngang. Hãy chuẩn hóa lại nó thành một mảng JSON Array hợp lệ. Đầu ra chỉ chứa đúng một mảng JSON sạch, KHÔNG có markdown, KHÔNG giải thích. Bắt buộc kết quả phải parse được bằng JSON.parse().`;

  const handleCopyNormalizePrompt = () => {
    navigator.clipboard.writeText(normalizePromptText)
      .then(() => {
        setCopiedNormalize(true);
        setTimeout(() => setCopiedNormalize(false), 2000);
      })
      .catch((err) => console.error("Copy failed", err));
  };

  const handleParseJson = () => {
    if (!jsonInput.trim()) return;
    setError(null);
    setSuccessCount(null);
    try {
      const cleanJson = jsonInput.replace(/```(?:json)?/g, "").trim();
      const parsedData = JSON.parse(cleanJson);

      if (!Array.isArray(parsedData)) {
        throw new Error("Dữ liệu không phải là một mảng JSON Array!");
      }

      const mapped = parsedData.map((item: any, idx: number) => ({
        id: `temp_${Date.now()}_${idx}`,
        front: item.front || "",
        back: item.back || "",
      }));
      
      setPreviewCards(mapped);
    } catch (err: any) {
      console.error(err);
      setError(`Lỗi Parse JSON: ${err.message || "Định dạng JSON không hợp lệ"}. Vui lòng kiểm tra lại cú pháp (nhớ có ngoặc vuông [] ở đầu, cuối).`);
    }
  };

  const handleUpdatePreviewCard = (id: string, field: 'front' | 'back', value: string) => {
    if (!previewCards) return;
    setPreviewCards(previewCards.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleDeletePreviewCard = (id: string) => {
    if (!previewCards) return;
    setPreviewCards(previewCards.filter(c => c.id !== id));
  };

  const isProcessingRef = useRef(false);

  const handleImportToFirestore = async () => {
    if (!previewCards || previewCards.length === 0 || isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    setError(null);
    setSuccessCount(null);
    setProgress(0);

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setError("Bạn chưa đăng nhập hoặc phiên đã hết hạn!");
      setIsProcessing(false);
      isProcessingRef.current = false;
      return;
    }

    try {
      const { v4: uuidv4 } = await import("uuid");
      const deckId = `deck_${uuidv4()}`;
      const newDeckObj: Deck = {
        id: deckId,
        title: deckTitle.trim() || "Bộ thẻ nhập tay",
        subject: deckSubject.trim() || "Tự chọn",
        cards: previewCards.map((c) => ({
          id: `card_${uuidv4()}`,
          front: c.front,
          back: c.back,
          subject: deckSubject.trim() || "Tự chọn",
          mastery: 0,
          nextReview: Date.now(),
          isHard: false
        }))
      };

      await store.addDeck(newDeckObj);

      setProgress(100);
      setSuccessCount(previewCards.length);
      setPreviewCards(null);
      setJsonInput("");
      setDeckTitle("");
      setDeckSubject("");
      
      // Auto dismiss success after some seconds
      setTimeout(() => setSuccessCount(null), 5000);
    } catch (err: any) {
      console.error(err);
      setError(`Lỗi Import Firestore: ${err.message || "Không thể lưu dữ liệu"}`);
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
      setProgress(null);
    }
  };

  return (
    <section className="glass p-6 md:p-8 rounded-2xl border border-blue-500/10 dark:border-blue-400/10 shadow-lg relative overflow-hidden mt-8 max-w-4xl mx-auto">
      <div className="absolute top-0 right-0 bg-blue-500 text-white text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-bl-xl">
        Admin Module
      </div>
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 border-b border-stone-200/50 dark:border-zinc-800/80 pb-6">
        <div>
          <h3 className="text-2xl font-display font-medium flex items-center gap-2 text-stone-800 dark:text-stone-100 mb-1">
            <Sparkles className="w-6 h-6 text-blue-500" /> Nạp Thẻ Học Bằng Cơm
          </h3>
          <p className="text-sm opacity-70">
            Khu vực nhập thủ công dự phòng nếu tự động hóa bị kẹt. (Parse, Edit, Push).
          </p>
        </div>
        
        <button 
          onClick={() => setShowToolModal(true)}
          className="shrink-0 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3 px-6 rounded-xl transition shadow-lg shadow-blue-500/25 active:scale-95"
        >
          <Database className="w-5 h-5" /> Convert Tài Liệu To JSON
        </button>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorNotification message={error} onRetry={() => setError(null)} />
        </div>
      )}

      {successCount !== null && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-xl text-sm font-bold flex items-center gap-3">
          <Check className="w-6 h-6 shrink-0" />
          <span>Đã đồng bộ thành công {successCount} thẻ học vào Database! Trạng thái Realtime đã cập nhật.</span>
        </div>
      )}

      {!previewCards ? (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <label className="block text-sm font-semibold opacity-80 mb-2">Dán Chuỗi JSON Vào Đây:</label>
          
          <p className="text-xs text-red-500 dark:text-red-400 font-medium mb-2">
            ⚠️ Phương pháp này là phương án dễ phát sinh lỗi cú pháp chuỗi JSON. =&gt; Khuyến khích sử dụng chức năng tự động hoá bên dưới.
          </p>

          <div className="flex flex-col items-start gap-3 mb-4">
            <button 
              onClick={() => setShowNormalize(!showNormalize)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-bold px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20 transition flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" /> Chuẩn hoá chuỗi JSON
            </button>

            {showNormalize && (
              <div className="flex flex-wrap items-center gap-2 p-3 bg-stone-100 dark:bg-zinc-800 rounded-xl border border-stone-200 dark:border-zinc-700 animate-in fade-in slide-in-from-top-1 duration-200">
                <button 
                  onClick={handleCopyNormalizePrompt}
                  className="flex items-center gap-1.5 bg-white dark:bg-zinc-700 hover:bg-stone-50 dark:hover:bg-zinc-600 px-3 py-1.5 rounded-lg text-sm font-semibold border border-stone-200 dark:border-zinc-600 transition"
                >
                  {copiedNormalize ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  {copiedNormalize ? "Đã Copy" : "Copy Prompt Yêu Cầu"}
                </button>
                <a 
                  href="https://gemini.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-semibold transition"
                >
                  Chuyển Sang Gemini <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>

          <textarea
            className="w-full h-56 bg-stone-100/50 dark:bg-zinc-900/50 border border-stone-200 dark:border-zinc-800 rounded-xl p-4 text-sm font-mono resize-y focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-stone-800 dark:text-stone-200 transition shadow-inner"
            placeholder='[\n  {\n    "front": "Từ khóa",\n    "back": "Định nghĩa"\n  }\n]'
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
          />

          <button 
            onClick={handleParseJson}
            disabled={!jsonInput.trim()}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-stone-800 dark:bg-stone-200 hover:bg-stone-900 dark:hover:bg-white text-stone-100 dark:text-stone-900 font-bold py-3 px-8 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed mx-auto"
          >
            <Edit3 className="w-4 h-4" /> Hiển Thị Bản Xem Trước & Chỉnh Sửa
          </button>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between mt-2">
            <h4 className="font-bold text-lg flex items-center gap-2">
              <Check className="w-5 h-5 text-emerald-500" /> Bản Xem Trước ({previewCards.length} Thẻ)
            </h4>
            <button 
              onClick={() => {
                setPreviewCards(null);
                setError(null);
              }}
              disabled={isProcessing}
              className="text-xs text-red-500 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition font-semibold"
            >
              Hủy / Sửa JSON
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold opacity-80 mb-2 block">Tên Bộ Thẻ:</label>
              <input 
                type="text" 
                value={deckTitle}
                onChange={(e) => setDeckTitle(e.target.value)}
                placeholder="VD: IELTS Vocabulary Unit 1"
                className="w-full bg-white dark:bg-zinc-950 border border-stone-200/50 dark:border-zinc-800/80 rounded-xl px-4 py-3 text-stone-900 dark:text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-sm font-semibold opacity-80 mb-2 block">Phân loại / Môn học:</label>
              <input 
                type="text" 
                value={deckSubject}
                onChange={(e) => setDeckSubject(e.target.value)}
                placeholder="VD: Vocabulary"
                className="w-full bg-white dark:bg-zinc-950 border border-stone-200/50 dark:border-zinc-800/80 rounded-xl px-4 py-3 text-stone-900 dark:text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2 scrollbar-thin">
            {previewCards.map((card, idx) => (
              <div key={card.id} className="p-4 bg-stone-100/60 dark:bg-zinc-900/60 border border-stone-200/50 dark:border-zinc-800 rounded-xl relative group">
                <div className="absolute -left-1 -top-1 bg-stone-800 dark:bg-stone-200 text-stone-100 dark:text-stone-900 text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold shadow-sm">
                  {idx + 1}
                </div>
                <button 
                  onClick={() => handleDeletePreviewCard(card.id)}
                  className="absolute top-2 right-2 p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition opacity-0 group-hover:opacity-100"
                  title="Xóa Thẻ Này"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <div className="pl-3 pr-6 space-y-3">
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider opacity-50 mb-1 block">Front</label>
                    <input
                      type="text"
                      value={card.front}
                      onChange={(e) => handleUpdatePreviewCard(card.id, 'front', e.target.value)}
                      className="w-full bg-white dark:bg-black border border-stone-200/50 dark:border-zinc-800/80 rounded-lg px-3 py-2 text-stone-900 dark:text-stone-100 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider opacity-50 mb-1 block">Back</label>
                    <textarea
                      value={card.back}
                      onChange={(e) => handleUpdatePreviewCard(card.id, 'back', e.target.value)}
                      className="w-full h-16 resize-none bg-white dark:bg-black border border-stone-200/50 dark:border-zinc-800/80 rounded-lg px-3 py-2 text-stone-900 dark:text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-stone-200/50 dark:border-zinc-800/80">
            {progress !== null && (
              <div className="mb-4">
                <div className="flex justify-between text-[10px] font-bold uppercase mb-1">
                  <span>Tiến độ Nạp</span>
                  <span className="text-blue-500">{progress}%</span>
                </div>
                <div className="w-full h-2 bg-stone-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
            
            <button 
              onClick={handleImportToFirestore}
              disabled={isProcessing || previewCards.length === 0}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed shadow-emerald-500/20 shadow-lg text-lg flex items-center justify-center gap-2"
            >
              {isProcessing ? "Đang Đồng Bộ Firestore..." : `Kích Hoạt Nạp ${previewCards.length} Thẻ Học`}
            </button>
          </div>
        </div>
      )}

      {/* TOOL MODAL */}
      {showToolModal && (
        <div className="modal-glass-overlay flex items-center justify-center p-4">
          <div className="modal-glass-content w-full max-w-2xl">
            <div className="px-6 py-4 flex justify-between items-center border-b border-stone-200/50 dark:border-zinc-800/50">
              <h3 className="font-display font-semibold text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-500" /> Chọn Trợ Lý AI
              </h3>
              <button 
                onClick={() => setShowToolModal(false)}
                className="p-1.5 hover:bg-stone-100 dark:hover:bg-zinc-800 rounded-lg text-stone-500 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Option 1 */}
              <div className="p-4 rounded-xl border border-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-500/5 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition group flex flex-col h-full">
                <h4 className="font-bold text-indigo-700 dark:text-indigo-400 mb-2 flex items-center gap-2">
                  <Database className="w-4 h-4" /> Khuyên Dùng
                </h4>
                <p className="text-sm opacity-80 mb-4 flex-grow">
                  Sử dụng Google AI Studio chuyên gia Agent đã được train sẵn dữ liệu, ép kiểu xuất file thần rành.
                </p>
                <a 
                  href="https://aistudio.google.com/app/prompts?state=%7B%22ids%22:%5B%2217MwznDpps2XqQ55uhRa8uhzXaMXCyAaC%22%5D,%22action%22:%22open%22,%22userId%22:%22101494878159029919274%22,%22resourceKeys%22:%7B%7D%7D&usp=sharing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full block text-center bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition text-sm mb-2"
                >
                  Mở Google AI Studio
                </a>
                <p className="text-[10px] text-center opacity-60 text-indigo-900 dark:text-indigo-200">
                  (Yêu cầu tài khoản Google trên 18 tuổi mới có thể truy cập)
                </p>
              </div>

              {/* Option 2 */}
              <div className="p-4 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-800/20 flex flex-col h-full">
                <h4 className="font-bold mb-2 flex items-center gap-2">
                  <Database className="w-4 h-4" /> Hệ Dự Phòng
                </h4>
                <p className="text-sm opacity-80 mb-4 flex-grow">
                  Sử dụng Gemini Web nếu không có tài khoản. Cần cấp Prompt cẩn thận để ra đúng format JSON.
                </p>
                <div className="space-y-2">
                  <button 
                    onClick={handleCopyPrompt}
                    className="w-full flex items-center justify-center gap-2 bg-stone-200 dark:bg-zinc-700 hover:bg-stone-300 dark:hover:bg-zinc-600 font-semibold py-2.5 rounded-lg transition text-sm"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Đã copy!" : "Bước 1: Copy Prompt"}
                  </button>
                  <a 
                    href="https://gemini.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition text-sm"
                  >
                    Mở Gemini Web <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-stone-200/50 dark:border-zinc-800/50 bg-stone-50 md:hidden dark:bg-zinc-800/20 text-center">
               <button onClick={() => setShowToolModal(false)} className="text-sm font-semibold opacity-70">Đóng</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
