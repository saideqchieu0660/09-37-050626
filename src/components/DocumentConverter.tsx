import React, { useState, useRef } from "react";
import { FileUp, FileText, Check, AlertCircle, Loader2, ChevronDown, Plus, Trash2 } from "lucide-react";
import { cn } from "../lib/utils";
import ErrorNotification from "./ErrorNotification";
import { store, Deck } from "../lib/store";

import { safeRequest } from "../utils/apiClient";

export default function DocumentConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  
  const [deckTitle, setDeckTitle] = useState("");
  const [deckSubject, setDeckSubject] = useState("");
  
  const [isCatDropdownOpen, setIsCatDropdownOpen] = useState(false);
  const catDropdownRef = useRef<HTMLDivElement>(null);
  const catInputRef = useRef<HTMLInputElement>(null);

  const [extractedCards, setExtractedCards] = useState<{id: string, front: string, back: string}[] | null>(null);

  const existingCategories = React.useMemo(() => {
    const allDecks = store.getDecks();
    const cats = allDecks.filter(d => d.subject).map(d => d.subject as string);
    return Array.from(new Set(cats));
  }, []);

  const filteredCategories = existingCategories.filter(c => 
    c.toLowerCase().includes(deckSubject.toLowerCase())
  );
  const exactMatchExists = existingCategories.some(
    c => c.toLowerCase() === deckSubject.toLowerCase()
  );

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (catDropdownRef.current && !catDropdownRef.current.contains(event.target as Node)) {
        setIsCatDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      // Limit to PDF or images, max 5MB for API stability
      if (selected.size > 5 * 1024 * 1024) {
         setError("Kích thước file vượt quá 5MB. Vui lòng chọn file nhẹ hơn.");
         setFile(null);
         return;
      }
      setFile(selected);
      setError(null);
      setSuccessCount(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const selected = e.dataTransfer.files[0];
      if (selected.size > 5 * 1024 * 1024) {
         setError("Kích thước file vượt quá 5MB.");
         setFile(null);
         return;
      }
      setFile(selected);
      setError(null);
      setSuccessCount(null);
    }
  };

  const handleConvert = async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    setSuccessCount(null);
    setProgress("Đang nén file và chuẩn bị tải lên...");
    
    try {
      // 1. Read file to Base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;
      
      const payload = {
        fileData: base64Data,
        mimeType: file.type || "application/pdf"
      };

      setProgress("Đang gửi đến AI Studio (có thể mất tới 30-45 giây)...");
      
      // 2. Stream Fetch
      const user = store.getCurrentUser();
      const idToken = user?.id || "anonymous"; 
      
      const res = await safeRequest("/api/convert-document", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": idToken,
          "x-user-role": user?.role || "teacher"
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const errObj = await res.json().catch(() => ({}));
        throw new Error(errObj.error || errObj.message || "Lỗi khi gọi API xử lý tài liệu");
      }
      
      if (!res.body) {
         throw new Error("Không nhận được dữ liệu (Stream trống)");
      }

      setProgress("AI đang cấu trúc dữ liệu...");
      
      const readerBody = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      
      let parsedCards: any[] = [];
      let buffer = "";

      while (true) {
        const { done, value } = await readerBody.read();
        if (done) break;
        
        const chunkStr = decoder.decode(value, { stream: true });
        buffer += chunkStr;
        
        // Process NDJSON lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // keep the last incomplete part in buffer
        
        for (const line of lines) {
           if (!line.trim()) continue;
           try {
              const data = JSON.parse(line);
              if (data.error) {
                 throw new Error(`[API_ERR|${data.path}] ${data.message}`);
              }
              if (data.status) {
                 setProgress(data.status);
              }
              if (data.flashcards && Array.isArray(data.flashcards)) {
                 parsedCards.push(...data.flashcards);
                 setProgress(`Đang tích luỹ được ${parsedCards.length} thẻ...`);
              }
           } catch (e: any) {
              if (e.message && e.message.startsWith("[API_ERR|")) {
                  throw e;
              }
              console.warn("Parse line JSON warning:", e);
           }
        }
      }
      
      if (!Array.isArray(parsedCards) || parsedCards.length === 0) {
         throw new Error("Không trích xuất được flashcard nào từ tài liệu.");
      }
      
      // Normalize cards
      const validCards = parsedCards.filter(c => c.front && c.back).map(c => ({
         front: c.front.toString(),
         back: c.back.toString()
      }));
      
      if (validCards.length === 0) {
         throw new Error("Tài liệu không đủ cấu trúc để nhận diện Học phần. Vui lòng kiểm tra lại file.");
      }

      // 3. Instead of saving immediately, allow user to review
      setProgress("Đang chuẩn bị thẻ để xem xét...");
      
      const { v4: uuidv4 } = await import("uuid");
      const mappedCards = validCards.map((c) => ({
        id: `card_${uuidv4()}`,
        front: c.front,
        back: c.back
      }));

      setExtractedCards(mappedCards);
      setSuccessCount(mappedCards.length);
      
      // Cleanup file state after extraction is successful
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setProgress("");
      setIsProcessing(false);
      
    } catch (err: any) {
      console.error(err);
      
      let errMsg = err.message || "Có lỗi bất ngờ xảy ra";
      let pathStr = "/api/convert-document";

      // Extract path and msg from our custom marker
      if (errMsg.startsWith("[API_ERR|")) {
         const closeBracket = errMsg.indexOf("]");
         if (closeBracket !== -1) {
             pathStr = errMsg.substring(9, closeBracket);
             errMsg = errMsg.substring(closeBracket + 1).trim();
         }
      }

      setError(errMsg);

      // Dispatch global error toast
      window.dispatchEvent(new CustomEvent("global-api-error", { 
         detail: { 
            message: errMsg, 
            path: pathStr,
            stack: err.stack 
         } 
      }));

    } finally {
      setIsProcessing(false);
      setProgress("");
      if (fileInputRef.current) {
         fileInputRef.current.value = "";
      }
    }
  };

  const handleSaveDeck = async () => {
    if (!extractedCards || extractedCards.length === 0) return;
    
    setIsProcessing(true);
    setProgress("Đang lưu hàng loạt (BatchWrite) vào cơ sở dữ liệu...");
    setError(null);
    
    try {
      const { v4: uuidv4 } = await import("uuid");
      const deckId = `deck_${uuidv4()}`;
      
      const titleToUse = deckTitle.trim() || `Tài liệu vừa tải lên`;
      const subjectToUse = deckSubject.trim() || "Tự chọn";

      const newDeckObj: Deck = {
        id: deckId,
        title: titleToUse,
        subject: subjectToUse,
        cards: extractedCards.map((c) => ({
          id: c.id,
          front: c.front,
          back: c.back,
          subject: subjectToUse,
          mastery: 0,
          nextReview: Date.now(),
          isHard: false
        }))
      };

      const { db } = await import("../lib/firebase");
      const { doc, writeBatch } = await import("firebase/firestore");
      const batch = writeBatch(db);
      
      const deckRef = doc(db, "sets", deckId);
      batch.set(deckRef, {
          id: newDeckObj.id,
          title: newDeckObj.title,
          subject: newDeckObj.subject,
          cards: newDeckObj.cards
      });
      
      await batch.commit();
      store.setTempDeck(newDeckObj); // Update UI store locally
      
      setSuccessCount(extractedCards.length);
      setExtractedCards(null);
      setDeckTitle("");
      setDeckSubject("");
      setProgress("Lưu thành công!");
      
    } catch (err: any) {
      console.error(err);
      setError("Lỗi lưu trữ Firestore BatchWrite: " + err.message);
    } finally {
      setIsProcessing(false);
      setTimeout(() => setProgress(""), 3000);
    }
  };

  const handleCardChange = (id: string, field: 'front' | 'back', value: string) => {
    if (!extractedCards) return;
    setExtractedCards(extractedCards.map(c => 
      c.id === id ? { ...c, [field]: value } : c
    ));
  };

  const handleRemoveCard = (id: string) => {
    if (!extractedCards) return;
    setExtractedCards(extractedCards.filter(c => c.id !== id));
  };

  return (
    <section className="card-3d rounded-3xl p-6 md:p-8 relative overflow-hidden">
      <div className="absolute top-0 right-0 bg-blue-500 text-white text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-bl-xl shadow-md">
        Option Tự động (Edge AI)
      </div>
      
      <div className="flex items-center gap-3 mb-2">
        <div className="p-3 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
          <FileUp className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-display font-semibold">Tự động hoá: Convert Tài liệu to Flashcard</h2>
          <p className="text-sm opacity-70">Tải lên file PDF, Hình ảnh bài học. Hệ thống AI sẽ tự động phân tích và tạo Học phần.</p>
        </div>
      </div>

      {error && <ErrorNotification message={error} onRetry={() => setError(null)} />}
      
      {successCount !== null && (
        <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 p-4 rounded-xl font-medium mb-6 animate-in fade-in slide-in-from-top-2">
          <Check className="w-5 h-5 flex-shrink-0" />
          Đã xử lý và lưu thành công {successCount} thẻ vào hệ thống!
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6 mt-6">
         {/* File Upload Zone */}
         <div>
            <div 
               className={cn(
                  "border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-colors h-48",
                  file ? "border-blue-500 bg-blue-500/5" : "border-stone-300 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-800",
                  isProcessing && "opacity-50 pointer-events-none"
               )}
               onDragOver={handleDragOver}
               onDrop={handleDrop}
               onClick={() => fileInputRef.current?.click()}
            >
               <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden" 
                  accept=".pdf,image/*" 
               />
               
               {file ? (
                  <>
                     <FileText className="w-10 h-10 text-blue-500 mb-3" />
                     <p className="font-semibold text-sm line-clamp-1">{file.name}</p>
                     <p className="text-xs opacity-60 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </>
               ) : (
                  <>
                     <FileUp className="w-10 h-10 text-stone-400 dark:text-zinc-600 mb-3" />
                     <p className="font-medium text-sm">Nhấn hoặc Kéo thả file vào đây</p>
                     <p className="text-xs opacity-60 mt-1">Hỗ trợ PDF, PNG, JPG (Tối đa 5MB)</p>
                  </>
               )}
            </div>
         </div>

         {/* Settings & Submission */}
         <div className="space-y-4">
            <div>
               <label className="text-xs font-bold uppercase opacity-70 mb-1 block">Tên Học Phần (Tùy chọn)</label>
               <input 
                  type="text" 
                  value={deckTitle} 
                  onChange={(e) => setDeckTitle(e.target.value)} 
                  disabled={isProcessing}
                  className="w-full input-3d px-3 py-2.5 text-sm disabled:opacity-50"
                  placeholder="Để trống AI sẽ tự đặt tên theo file"
               />
            </div>
            <div ref={catDropdownRef} className="relative z-[100]">
               <label className="text-xs font-bold uppercase opacity-70 mb-1 block">Danh mục / Môn học (Tùy chọn)</label>
               <div className="relative">
                 <input 
                    ref={catInputRef}
                    type="text" 
                    value={deckSubject} 
                    onChange={(e) => {
                      setDeckSubject(e.target.value);
                      setIsCatDropdownOpen(true);
                    }} 
                    onFocus={() => setIsCatDropdownOpen(true)}
                    disabled={isProcessing}
                    className="w-full input-3d px-3 py-2.5 pr-10 text-sm disabled:opacity-50"
                    placeholder="VD: Lịch sử, Toeic..."
                    autoComplete="off"
                 />
                 <div className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer opacity-50 hover:opacity-100 transition-opacity" onClick={() => setIsCatDropdownOpen(!isCatDropdownOpen)}>
                   <ChevronDown className={cn("w-4 h-4 transition-transform", isCatDropdownOpen && "rotate-180")} />
                 </div>
               </div>

               {isCatDropdownOpen && !isProcessing && (
                 <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] dark:shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] overflow-hidden z-[200] animate-in fade-in zoom-in-95 duration-200 block">
                   <div className="w-full flex flex-col">
                     <div 
                       className="max-h-[220px] overflow-y-auto w-full p-1.5 space-y-0.5"
                       style={{ WebkitOverflowScrolling: "touch" }}
                     >
                       {filteredCategories.map((cat, idx) => (
                         <button
                           key={idx}
                           type="button"
                           onClick={(e) => {
                             e.preventDefault();
                             e.stopPropagation();
                             setDeckSubject(cat);
                             setIsCatDropdownOpen(false);
                           }}
                           className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-stone-100 dark:hover:bg-zinc-800 transition font-medium text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100"
                         >
                           {cat}
                         </button>
                       ))}
                       
                       {(!exactMatchExists && deckSubject.trim() !== '') && (
                         <button
                           type="button"
                           onClick={(e) => {
                             e.preventDefault();
                             e.stopPropagation();
                             // Value is already in deckSubject, just close
                             catInputRef.current?.focus();
                             setIsCatDropdownOpen(false);
                           }}
                           className="w-full text-left px-3 py-2.5 text-sm rounded-lg bg-blue-50/50 hover:bg-blue-100/50 dark:bg-blue-900/10 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-semibold transition flex items-center gap-2 mt-1 border border-transparent hover:border-blue-200 dark:hover:border-blue-800"
                         >
                           <Plus className="w-4 h-4 shrink-0" /> Tạo "{deckSubject}"
                         </button>
                       )}

                       {(filteredCategories.length === 0 && deckSubject.trim() === '') && (
                          <div className="px-3 py-4 text-xs text-center opacity-50 font-medium">Bạn chưa có danh mục nào</div>
                       )}
                     </div>
                     
                     {deckSubject.trim() === '' && (
                       <div className="p-1.5 border-t border-stone-100 dark:border-zinc-800/50 bg-stone-50/50 dark:bg-zinc-900 hover:bg-stone-100 dark:hover:bg-zinc-800 transition">
                         <button
                           type="button"
                           onClick={(e) => {
                             e.preventDefault();
                             e.stopPropagation();
                             setDeckSubject("");
                             catInputRef.current?.focus();
                           }}
                           className="w-full text-left px-3 py-2 text-sm rounded-lg font-semibold transition flex items-center gap-2 text-blue-600 dark:text-blue-400"
                         >
                           <Plus className="w-4 h-4 shrink-0" /> Tạo danh mục mới
                         </button>
                       </div>
                     )}
                   </div>
                 </div>
               )}
            </div>
            
            <button 
               onClick={handleConvert}
               disabled={!file || isProcessing}
               className="w-full btn-3d btn-3d-primary py-3 flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
            >
               {isProcessing ? (
                  <>
                     <Loader2 className="w-5 h-5 animate-spin" />
                     Đang xử lý...
                  </>
               ) : (
                  "Bắt đầu chuyển đổi AI"
               )}
            </button>
            
            {isProcessing && progress && (
               <p className="text-xs text-blue-600 dark:text-blue-400 text-center animate-pulse mt-2">{progress}</p>
            )}
            <p className="text-xs text-red-500 dark:text-red-400 italic text-center mt-3">
               AI có thể mắc sai lầm, hãy cẩn trọng! Khuyến nghị chia nhỏ files nhằm tối ưu hoá chất lượng đầu ra của hệ thống. VD: chia nhỏ theo bài / Unit / dưới 200 vocab là tối ưu nhất
            </p>
         </div>
      </div>

      {extractedCards && extractedCards.length > 0 && (
        <div className="mt-8 pt-8 border-t border-stone-200 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold">Review {extractedCards.length} thẻ mới tạo</h3>
            <button 
              onClick={handleSaveDeck}
              disabled={isProcessing}
              className="btn-3d-primary px-6 py-2 disabled:opacity-50"
            >
              {isProcessing ? "Đang lưu..." : "Lưu Học Phần"}
            </button>
          </div>
          
          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {extractedCards.map((c, i) => (
              <div key={c.id} className="card-3d p-4 rounded-xl border flex gap-4">
                <div className="flex-shrink-0 text-stone-400 font-bold w-6">{i + 1}</div>
                <div className="flex-grow grid md:grid-cols-2 gap-4">
                  <textarea
                    value={c.front}
                    onChange={(e) => handleCardChange(c.id, 'front', e.target.value)}
                    className="input-3d p-3 min-h-[80px] w-full text-sm"
                    placeholder="Mặt trước..."
                  />
                  <textarea
                    value={c.back}
                    onChange={(e) => handleCardChange(c.id, 'back', e.target.value)}
                    className="input-3d p-3 min-h-[80px] w-full text-sm"
                    placeholder="Mặt sau..."
                  />
                </div>
                <button 
                  onClick={() => handleRemoveCard(c.id)}
                  className="flex-shrink-0 self-start p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
