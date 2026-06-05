import React, { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { store, Flashcard, Deck } from "../lib/store";
import { Check, X, RefreshCcw, ArrowLeft, BrainCircuit, Edit3, Sparkles, Volume2, VolumeX, Type, Pin, PinOff, Minimize2, Maximize2, Play, Pause, Clock, BellPlus, Trash2, Plus, AlertCircle, BarChart3, Activity as ActivityIcon, Download } from "lucide-react";
import { playFlipSound, playCorrectSound, playIncorrectSound, toggleMute, getIsMuted, initAudio } from "../lib/audio";
import { cn } from "../lib/utils";
import { safeRequest } from "../utils/apiClient";
import { useAICooldown } from "../lib/cooldown";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { motion } from "motion/react";
import { triggerCelebration } from "../lib/celebration";
import { v4 as uuidv4 } from "uuid";
import { db, auth } from "../lib/firebase";
import { doc, onSnapshot, collection } from "firebase/firestore";
import { 
  ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip
} from "recharts";

const MOTIVATION_QUOTES = [
  "It is not because things are difficult that we do not dare; it is because we do not dare that they are difficult. - Seneca",
  "The impediment to action advances action. What stands in the way becomes the way. - Marcus Aurelius",
  "You have power over your mind - not outside events. - Marcus Aurelius",
  "Luck is what happens when preparation meets opportunity. - Seneca"
];

// Confetti component removed

export default function StudyRoom() {
  useEffect(() => {
    document.title = "Henosis - Study Room";
  }, []);

  const user = store.getCurrentUser();
  const { cooldownRemaining, startCooldown } = useAICooldown(user);
  const { deckId } = useParams();
  const [deck, setDeck] = useState<any>(() => store.getDeck(deckId || ""));
  const [isLoading, setIsLoading] = useState(true);
  const [rawDeck, setRawDeck] = useState<any>(null);
  const [personalCardStates, setPersonalCardStates] = useState<any[]>([]);

  // 1. Listen to raw deck structure in real-time
  const unsubDeckRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    setIsLoading(true);
    if (!deckId || !user) return;
    
    // Daily Quest logic bypasses server fetch since it's a transient frontend assembly
    if (deckId === 'daily-quest') {
       const localDq = store.getDeck('daily-quest');
       if (localDq) setRawDeck(localDq);
       setIsLoading(false);
       return;
    }

    if (unsubDeckRef.current) unsubDeckRef.current();
    try {
      unsubDeckRef.current = onSnapshot(doc(db, "sets", deckId), (docSnap) => {
        if (docSnap.exists()) {
          setRawDeck(docSnap.data());
        }
        setIsLoading(false);
      });
    } catch (e) {
      console.error("Failed to sync room deck in real-time:", e);
      setIsLoading(false);
    }
    return () => {
      if (unsubDeckRef.current) unsubDeckRef.current();
    };
  }, [deckId, user?.id]);

  // 2. Listen to personal card states in real-time
  const unsubCardStatesRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!user) return;
    if (unsubCardStatesRef.current) unsubCardStatesRef.current();
    try {
      unsubCardStatesRef.current = onSnapshot(collection(db, "users", user.id, "cardsState"), (snapshot) => {
        const states: any[] = [];
        snapshot.forEach((docSnap) => {
          states.push({ id: docSnap.id, ...docSnap.data() });
        });
        setPersonalCardStates(states);
      }, (err) => {
        console.error("StudyRoom cardsState sync error:", err);
      });
    } catch (e) {
      console.error("Failed to sync study room card states:", e);
    }
    return () => {
      if (unsubCardStatesRef.current) unsubCardStatesRef.current();
    };
  }, [user?.id]);

  // 3. Merge raw deck and personal card states to form reactive deck
  useEffect(() => {
    if (!rawDeck) return;
    const stateMap = new Map();
    if (personalCardStates && personalCardStates.length > 0) {
      personalCardStates.forEach((s) => stateMap.set(s.id, s));
    }

    const mergedDeck = { ...rawDeck };
    if (mergedDeck.cards) {
      mergedDeck.cards = mergedDeck.cards.map((card: any) => {
        const savedState = stateMap.get(card.id);
        if (savedState) {
          return {
            ...card,
            mastery: typeof savedState.mastery === 'number' ? savedState.mastery : card.mastery,
            nextReview: typeof savedState.nextReview === 'number' ? savedState.nextReview : card.nextReview,
            interval: typeof savedState.interval === 'number' ? savedState.interval : card.interval,
            repetition: typeof savedState.repetition === 'number' ? savedState.repetition : card.repetition,
            efactor: typeof savedState.efactor === 'number' ? savedState.efactor : card.efactor,
            isHard: typeof savedState.isWeakCard !== 'undefined' ? savedState.isWeakCard : card.isHard
          };
        }
        return card;
      });
    }

    const updateStore = async () => {
      const { store: globalStore } = await import("../lib/store");
      const currentDecks = [...globalStore.getDecks()];
      const existIdx = currentDecks.findIndex(d => d.id === mergedDeck.id);
      if (existIdx >= 0) {
         currentDecks[existIdx] = mergedDeck;
         if (typeof (globalStore as any).setDecksLocally === 'function') {
           (globalStore as any).setDecksLocally(currentDecks);
         }
      }
    };
    updateStore();
    setDeck(mergedDeck);
  }, [rawDeck, personalCardStates]);

  const [studyQueue, setStudyQueue] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
     if (finished) triggerCelebration();
  }, [finished]);
  const [sessionCorrectCount, setSessionCorrectCount] = useState(0);
  const [sessionMasteryGained, setSessionMasteryGained] = useState(0);
  const [sessionHistory, setSessionHistory] = useState<Array<{
    cardIndex: number;
    front: string;
    status: "correct" | "incorrect" | "skipped";
    cumulativeCorrect: number;
    cumulativeStudied: number;
    accuracy: number;
    masteryChange: number;
  }>>([]);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [isUpdatingCard, setIsUpdatingCard] = useState(false);
  const [editSuccessMessage, setEditSuccessMessage] = useState<string | null>(null);
  
  const [muted, setMuted] = useState(getIsMuted());

  const handleToggleMute = () => {
     setMuted(toggleMute());
  };

  const handleExportDeck = () => {
    if (!deck) return;
    const blob = new Blob([JSON.stringify(deck, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deck.title.replace(/\s+/g, '_').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFlip = () => {
    if (!isEditing) {
      if (!isFlipped) playFlipSound(); // Optionally play sound both on flip and unflip, but just play it
      else playFlipSound();
      setIsFlipped(!isFlipped);
    }
  };

  const [deepExplanation, setDeepExplanation] = useState<string | null>(null);
  const [isSerif, setIsSerif] = useState(true);
  const [isPinned, setIsPinned] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [quote] = useState(MOTIVATION_QUOTES[Math.floor(Math.random() * MOTIVATION_QUOTES.length)]);

  const [studyMode, setStudyMode] = useState<"all" | "weak">("all");
  const [weakCardIds, setWeakCardIds] = useState<string[]>([]);
  const [showRemindToast, setShowRemindToast] = useState(false);
  
  // Pomodoro
  const POMODORO_MINS = 25;
  const [timerSeconds, setTimerSeconds] = useState(POMODORO_MINS * 60);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isTimerFinished, setIsTimerFinished] = useState(false);

  useEffect(() => {
    let interval: any;
    if (isTimerRunning && timerSeconds > 0) {
      interval = setInterval(() => {
        setTimerSeconds(s => s - 1);
      }, 1000);
    } else if (isTimerRunning && timerSeconds === 0) {
      setIsTimerRunning(false);
      setIsTimerFinished(true);
      store.addBonusPoints(25);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerSeconds]);

  const toggleTimer = () => {
    if (isTimerFinished) {
      setTimerSeconds(POMODORO_MINS * 60);
      setIsTimerFinished(false);
      setIsTimerRunning(true);
    } else {
      setIsTimerRunning(!isTimerRunning);
    }
  };

  const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (deck) {
      const storageKey = `weak_cards_${deck.id}`;
      const savedWeakIds = JSON.parse(localStorage.getItem(storageKey) || "[]");
      setWeakCardIds(savedWeakIds);
      
      let due = deck.cards || [];
      if (deck.id === "daily-quest") {
          const now = Date.now();
          // Filter cards based on mastery and next review time
          const reviewCards = due.filter((c: any) => c.mastery > 0 && c.nextReview <= now);
          const newCards = due.filter((c: any) => !c.mastery || c.mastery === 0 || !c.nextReview);
          
          // Mix 80% review (up to 16 cards) and 20% new (up to 4 cards) = max 20 cards standard
          const shuffledReview = reviewCards.sort(() => Math.random() - 0.5).slice(0, 16);
          const shuffledNew = newCards.sort(() => Math.random() - 0.5).slice(0, 4);
          
          due = [...shuffledReview, ...shuffledNew].sort(() => Math.random() - 0.5);
          
          // If no due cards, we can just grab some new or random cards to keep the daily quest active
          if (due.length === 0) {
              due = newCards.sort(() => Math.random() - 0.5).slice(0, 10);
          }
      }
      setStudyQueue(due);
    }
  }, [deck]);

  useEffect(() => {
    const unlockAudio = () => {
      initAudio();
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
    window.addEventListener("click", unlockAudio);
    window.addEventListener("touchstart", unlockAudio);
    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
  }, []);

  const startReviewXCards = () => {
    if (!deck) return;
    const storageKey = `weak_cards_${deck.id}`;
    const savedWeakIds = JSON.parse(localStorage.getItem(storageKey) || "[]");
    const weakCards = (deck.cards || []).filter((c: any) => savedWeakIds.includes(c.id));
    
    if (weakCards.length === 0) {
       alert("Tuyệt vời! Bạn không còn thẻ nào bị đánh dấu X trong bộ này.");
       return;
    }
    
    setWeakCardIds(savedWeakIds);
    setStudyQueue(weakCards);
    setStudyMode("weak");
    setCurrentIndex(0);
    setSessionCorrectCount(0);
    setSessionMasteryGained(0);
    setSessionHistory([]);
    setFinished(false);
    setIsFlipped(false);
    if (!isPinned) setDeepExplanation(null);
    else setIsMinimized(true);
  };
  
  const startReviewAll = () => {
    if (!deck) return;
    setStudyQueue(deck.cards || []);
    setStudyMode("all");
    setCurrentIndex(0);
    setSessionCorrectCount(0);
    setSessionMasteryGained(0);
    setSessionHistory([]);
    setFinished(false);
    setIsFlipped(false);
    if (!isPinned) setDeepExplanation(null);
    else setIsMinimized(true);
  };

  const currentCard = studyQueue[currentIndex];

  const handleMark = (remembered: boolean) => {
    initAudio();
    if (currentCard) {
      if (remembered) {
         playCorrectSound();
         setSessionCorrectCount(prev => prev + 1);
      } else {
         playIncorrectSound();
      }
      
      const oldMastery = currentCard.mastery;
      const targetDeckId = currentCard.originDeckId || deck.id;
      store.updateCardMastery(targetDeckId, currentCard.id, remembered);
      const newMastery = currentCard.mastery; // Since updateCardMastery updates the object reference in memory
      const diff = newMastery - oldMastery;
      setSessionMasteryGained(prev => prev + diff);
      
      const nextCorrectCount = sessionCorrectCount + (remembered ? 1 : 0);
      const nextStudiedCount = sessionHistory.length + 1;
      const nextAccuracy = Math.round((nextCorrectCount / nextStudiedCount) * 100);

      setSessionHistory(prev => [
        ...prev,
        {
          cardIndex: nextStudiedCount,
          front: currentCard.front,
          status: remembered ? "correct" : "incorrect",
          cumulativeCorrect: nextCorrectCount,
          cumulativeStudied: nextStudiedCount,
          accuracy: nextAccuracy,
          masteryChange: diff,
        }
      ]);

      const storageKey = `weak_cards_${deck.id}`;
      let weakIds = JSON.parse(localStorage.getItem(storageKey) || "[]");
      
      if (!remembered) {
         if (!weakIds.includes(currentCard.id)) {
            weakIds.push(currentCard.id);
         }
      } else {
         weakIds = weakIds.filter((id: string) => id !== currentCard.id);
      }
      
      localStorage.setItem(storageKey, JSON.stringify(weakIds));
      setWeakCardIds(weakIds);
    }
    
    if (!isPinned) setDeepExplanation(null);
    else setIsMinimized(true);

    setIsFlipped(false);
    if (currentIndex + 1 < studyQueue.length) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setFinished(true);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (finished || !currentCard || isExtracting || isEditing) return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleFlip();
      } else if (e.code === 'ArrowLeft') {
        if (isFlipped) {
          e.preventDefault();
          handleMark(false);
        }
      } else if (e.code === 'ArrowRight') {
        if (isFlipped) {
          e.preventDefault();
          handleMark(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [finished, currentCard, isExtracting, isEditing, isFlipped, deckId, currentIndex]); // using deps carefully to avoid infinite re-renders

  const handleAgent2 = async () => {
    if (!currentCard) return;

    if (user && user.role === "student" && cooldownRemaining > 0) {
      setDeepExplanation(`⏳ **Hệ thống AI đang hạ nhiệt**: Bạn là Học sinh, vui lòng đợi thêm **${cooldownRemaining} giây** để hỏi giải thích tiếp theo nhé.`);
      return;
    }

    setIsExtracting(true);
    setIsMinimized(false);

    if (user && user.role === "student") {
      startCooldown();
    }

    try {
      const idToken = await auth.currentUser?.getIdToken() || "";
      const res = await safeRequest("/api/agent2/explain", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
          "x-user-id": user?.id || "",
          "x-user-role": user?.role || ""
        },
        body: JSON.stringify({ 
          term: currentCard.front, 
          definition: currentCard.back, 
          subject: currentCard.subject 
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        if (res.status === 429) {
          setDeepExplanation(`⏳ **Cooldown 5s**: ${errData.error || "Bạn đang gọi AI quá nhanh. Hãy chờ!"}`);
          setIsExtracting(false);
          return;
        }
        throw new Error(errData.error || "Failed to query express backend");
      }

      const data = await res.json();
      setDeepExplanation(data.result);
    } catch (e: any) {
      setDeepExplanation("Failed to router extract. Check AI connection. Error: " + (e.message || e));
    }
    setIsExtracting(false);
  };

  const handleRemindLater = () => {
    if (!currentCard) return;
    const existing = JSON.parse(localStorage.getItem("remind_later_items") || "[]");
    if (!existing.includes(currentCard.id)) {
      existing.push(currentCard.id);
      localStorage.setItem("remind_later_items", JSON.stringify(existing));
    }
    
    setShowRemindToast(true);
    setTimeout(() => setShowRemindToast(false), 2000);
    
    const nextStudiedCount = sessionHistory.length + 1;
    const nextAccuracy = Math.round((sessionCorrectCount / nextStudiedCount) * 100);

    setSessionHistory(prev => [
      ...prev,
      {
        cardIndex: nextStudiedCount,
        front: currentCard.front,
        status: "skipped",
        cumulativeCorrect: sessionCorrectCount,
        cumulativeStudied: nextStudiedCount,
        accuracy: nextAccuracy,
        masteryChange: 0,
      }
    ]);

    // Move to next card
    setIsFlipped(false);
    if (!isPinned) setDeepExplanation(null);
    else setIsMinimized(true);

    if (currentIndex + 1 < studyQueue.length) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setFinished(true);
    }
  };

  const handleEditOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditFront(currentCard.front);
    setEditBack(currentCard.back);
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!deck || !currentCard) return;

    setIsUpdatingCard(true);
    try {
      const { db } = await import("../lib/firebase");
      const { doc, getDoc, updateDoc } = await import("firebase/firestore");

      let updatedDocCards = [];
      const targetDeckId = currentCard.originDeckId || deck.id;
      const docRef = doc(db, "sets", targetDeckId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        const currentCards = data.cards || [];
        updatedDocCards = currentCards.map((c: any) =>
          c.id === currentCard.id ? { ...c, front: editFront, back: editBack } : c
        );
      } else {
        // Fallback for missing offline maps etc but this should mostly be exact match
        updatedDocCards = [ { ...currentCard, front: editFront, back: editBack } ]; // dummy fallback
      }

      // Save to Firestore
      await updateDoc(docRef, {
        cards: updatedDocCards
      });

      // Update local state ONLY on success
      store.updateCard(targetDeckId, currentCard.id, editFront, editBack);
      currentCard.front = editFront;
      currentCard.back = editBack;

      setEditSuccessMessage("Đã cập nhật dữ liệu thẻ thành công!");
      setTimeout(() => setEditSuccessMessage(null), 3000);
      setIsEditing(false);
    } catch (err) {
      const { handleFirestoreError, OperationType } = await import("../lib/firebase");
      handleFirestoreError(err, OperationType.UPDATE, `sets/`);
    } finally {
      setIsUpdatingCard(false);
    }
  };

  const handleAddCard = async () => {
    if (!deck) return;
    // Logic removed
    setIsUpdatingCard(true);
    try {
      const { db } = await import("../lib/firebase");
      const { doc, updateDoc, arrayUnion } = await import("firebase/firestore");

      const newCardObj: Flashcard = {
        id: `card_${uuidv4().substring(0, 8)}`,
        front: "Khái niệm mới",
        back: "Giải nghĩa chi tiết",
        subject: deck.subject || "general",
        mastery: 0,
        nextReview: Date.now(),
        isHard: false
      };

      await updateDoc(doc(db, "sets", deck.id), {
        cards: arrayUnion(newCardObj)
      });

      store.addCardLocally(deck.id, newCardObj);
      setStudyQueue(prev => [...prev, newCardObj]);
      
      setEditSuccessMessage("Đã thêm một thẻ mới vào bộ học tập!");
      setTimeout(() => setEditSuccessMessage(null), 3000);
    } catch (err) {
      const { handleFirestoreError, OperationType } = await import("../lib/firebase");
      handleFirestoreError(err, OperationType.UPDATE, `sets/${deck.id}`);
    } finally {
      setIsUpdatingCard(false);
    }
  };

  const handleRemoveCard = async (targetCard: Flashcard) => {
    if (!deck) return;
    setIsUpdatingCard(true);
    try {
      const { db } = await import("../lib/firebase");
      const { doc, getDoc, updateDoc } = await import("firebase/firestore");

      const targetDeckId = (targetCard as any).originDeckId || deck.id;
      const docRef = doc(db, "sets", targetDeckId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
         const data = docSnap.data();
         const currentCards = data.cards || [];
         const filteredCards = currentCards.filter((c: any) => c.id !== targetCard.id);
         await updateDoc(docRef, {
            cards: filteredCards
         });
      }

      store.removeCardLocally(targetDeckId, targetCard.id);
      setStudyQueue(prev => prev.filter(c => c.id !== targetCard.id));
      
      setEditSuccessMessage("Đã xóa thẻ thành công!");
      setTimeout(() => setEditSuccessMessage(null), 3000);
    } catch (err) {
      const { handleFirestoreError, OperationType } = await import("../lib/firebase");
      handleFirestoreError(err, OperationType.UPDATE, `sets/`);
    } finally {
      setIsUpdatingCard(false);
    }
  };

  if (finished) {
    const percentage = studyQueue.length > 0 ? Math.round((sessionCorrectCount / studyQueue.length) * 100) : 0;
    const memoryProjection = Math.round(percentage * 0.7);

    // Compute Benchmark Stats
    const sessionCardsMasteryAvg = studyQueue.length 
      ? Math.round(studyQueue.reduce((sum, c) => sum + (Number(c.mastery) || 0), 0) / studyQueue.length) 
      : 0;

    const currentDeckMasteryAvg = deck?.cards?.length 
      ? Math.round(deck.cards.reduce((sum: number, c: any) => sum + (c.mastery || 0), 0) / deck.cards.length) 
      : 0;

    let weeklyAvgMastery = 0;
    if (user) {
      const allDecks = store.getDecks();
      const allCards = allDecks.flatMap(d => d.cards || []);
      
      const userHistory = store.getReviewHistory(user.id);
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weeklyReviews = userHistory.filter(r => r.timestamp >= oneWeekAgo);

      if (weeklyReviews.length > 0) {
        const reviewedCardIds = new Set(weeklyReviews.map(r => r.cardId));
        const reviewedCards = allCards.filter(c => reviewedCardIds.has(c.id));
        if (reviewedCards.length > 0) {
          weeklyAvgMastery = Math.round(reviewedCards.reduce((sum, c) => sum + (c.mastery || 0), 0) / reviewedCards.length);
        }
      }

      if (weeklyAvgMastery === 0 && allCards.length > 0) {
        weeklyAvgMastery = Math.round(allCards.reduce((sum, c) => sum + (c.mastery || 0), 0) / allCards.length);
      }
    }
    
    if (weeklyAvgMastery === 0) {
      weeklyAvgMastery = 50; 
    }

    const deltaMastery = sessionCardsMasteryAvg - weeklyAvgMastery;

    return (
      <div className="flex items-center justify-center min-h-[80vh] py-8 animate-in zoom-in-95 duration-500 px-4">
        <div className="glass p-6 md:p-10 rounded-3xl max-w-5xl w-full space-y-8 relative z-10">
          
          {/* Header Section */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 px-4 py-1.5 rounded-full text-sm font-bold border border-yellow-500/20">
              🎉 HOÀN THÀNH PHIÊN HỌC
            </div>
            <h2 className="text-3xl md:text-4xl font-black font-display text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500">
              Chúc Mừng Bạn Đã Học Xong!
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left Column: Metrics and Control Buttons */}
            <div className="lg:col-span-5 space-y-6">
              
              {/* Circular Percentage and quick view */}
              <div className="bg-stone-200/50 dark:bg-zinc-800/40 p-6 rounded-2xl border border-amber-600/10 dark:border-amber-500/20 flex flex-col items-center">
                <div className="relative w-36 h-36 flex flex-col items-center justify-center mb-4">
                  <div className="absolute inset-0 bg-yellow-500/10 rounded-full animate-pulse"></div>
                  <span className="text-[10px] uppercase font-bold tracking-wider opacity-60 text-stone-500 dark:text-stone-400">Tỷ lệ đúng</span>
                  <span className="text-4xl font-display font-black text-yellow-600 dark:text-yellow-400">{percentage}%</span>
                </div>
                
                <div className="grid grid-cols-3 gap-3 w-full text-center">
                  <div className="bg-background/40 p-2 rounded-xl border border-stone-200/50 dark:border-zinc-850">
                    <span className="block text-lg font-black text-stone-800 dark:text-stone-200">{studyQueue.length}</span>
                    <span className="text-[9px] uppercase font-bold opacity-60 block mt-0.5">Đã ôn</span>
                  </div>
                  <div className="bg-background/40 p-2 rounded-xl border border-stone-200/50 dark:border-zinc-850">
                    <span className={cn("block text-lg font-black", sessionMasteryGained >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500")}>
                      {sessionMasteryGained > 0 ? "+" : ""}{sessionMasteryGained}
                    </span>
                    <span className="text-[9px] uppercase font-bold opacity-60 block mt-0.5">Thông thạo</span>
                  </div>
                  <div className="bg-background/40 p-2 rounded-xl border border-stone-200/50 dark:border-zinc-850">
                    <span className="block text-lg font-black text-blue-600 dark:text-blue-400">+{memoryProjection}%</span>
                    <span className="text-[9px] uppercase font-bold opacity-60 block mt-0.5">Ghi nhớ</span>
                  </div>
                </div>
              </div>

              {/* Motivation quote card */}
              <div className="p-5 bg-stone-200/40 dark:bg-zinc-800/20 rounded-2xl border-l-4 border-yellow-500 text-left">
                <p className="font-serif italic text-sm opacity-85 leading-relaxed">"{quote}"</p>
              </div>

              {/* Actions list */}
              <div className="flex flex-col gap-3">
                <button 
                  onClick={startReviewAll} 
                  className="w-full px-5 py-3.5 rounded-xl bg-stone-300/60 dark:bg-zinc-800/80 font-bold hover:bg-black/20 dark:hover:bg-white/10 transition flex items-center justify-center gap-2 text-sm border border-stone-400/20 dark:border-zinc-700/40"
                >
                  <RefreshCcw className="w-4 h-4 text-amber-500" />
                  Ôn tập lại từ đầu (Review All)
                </button>
                {weakCardIds.length > 0 && (
                  <button 
                    onClick={startReviewXCards} 
                    className="w-full px-5 py-3.5 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 font-bold hover:bg-red-500 hover:text-white transition flex items-center justify-center gap-2 text-sm border border-red-500/20"
                  >
                    <X className="w-4 h-4" />
                    Ôn tập thẻ X ({weakCardIds.length})
                  </button>
                )}
                <Link 
                  to="/dashboard" 
                  className="w-full px-5 py-3.5 rounded-xl bg-yellow-500 text-black font-bold hover:bg-yellow-600 transition shadow-lg flex items-center justify-center gap-2 text-sm"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Trở về Dashboard
                </Link>
              </div>
            </div>

            {/* Right Column: Beautiful Interactive Session Progress Chart */}
            <div className="lg:col-span-7 bg-stone-200/40 dark:bg-zinc-800/30 p-5 md:p-6 rounded-3xl border border-stone-200 dark:border-zinc-800 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-350 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-yellow-500" />
                  <h3 className="font-bold text-stone-800 dark:text-stone-100 text-base font-display">Biểu Đồ Tiến Trình Phiên Học</h3>
                </div>
                <div className="flex gap-1 bg-stone-300/40 dark:bg-zinc-900/50 p-1 rounded-lg self-start">
                  <span className="text-[11px] font-bold text-yellow-600 dark:text-yellow-400 px-2 py-1 font-mono uppercase bg-yellow-500/10 rounded-md">
                    Chính Xác & Độ Thông Thạo
                  </span>
                </div>
              </div>

              {/* The Chart container */}
              <div className="h-64 sm:h-72 w-full">
                {sessionHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={sessionHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="accuracyGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0}/>
                        </linearGradient>
                        <linearGradient id="masteryGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#888888" strokeOpacity={0.1} />
                      <XAxis 
                        dataKey="cardIndex" 
                        stroke="#888888" 
                        fontSize={11} 
                        tickLine={false}
                        axisLine={false}
                        label={{ value: 'Số thẻ học', position: 'insideBottom', offset: -5, fill: '#888888', fontSize: 10 }}
                      />
                      <YAxis 
                        stroke="#888888" 
                        fontSize={11} 
                        tickLine={false}
                        axisLine={false}
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'rgba(28, 25, 23, 0.95)', 
                          borderColor: '#f59e0b', 
                          borderRadius: '12px',
                          color: '#fff',
                          fontSize: '12px'
                        }}
                        formatter={(value: any, name: any, props: any) => {
                          if (name === "accuracy") return [`${value}%`, "Độ chính xác tích lũy"];
                          if (name === "masteryChange") return [`${value > 0 ? "+" : ""}${value}`, "Thay đổi thông thạo"];
                          return [value, name];
                        }}
                        labelFormatter={(label) => `Thẻ số ${label} (Mặt trước: "${sessionHistory[Number(label) - 1]?.front || ''}")`}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="accuracy" 
                        stroke="#f59e0b" 
                        strokeWidth={2.5}
                        fillOpacity={1} 
                        fill="url(#accuracyGrad)" 
                        name="accuracy"
                      />
                      <Area 
                        type="monotone" 
                        dataKey="masteryChange" 
                        stroke="#3b82f6" 
                        strokeWidth={1.5}
                        fillOpacity={1} 
                        fill="url(#masteryGrad)" 
                        name="masteryChange"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full opacity-60 text-sm italic">
                    Không có đủ dữ liệu để dựng biểu đồ. Hãy thử học một vài thẻ trước!
                  </div>
                )}
              </div>

              {/* Progress Detail List (Interactive grid) */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wider flex items-center gap-1">
                  <ActivityIcon className="w-3.5 h-3.5 text-yellow-500" />
                  Nhật Ký Học Tập Phiên Này
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-36 overflow-y-auto pr-1">
                  {sessionHistory.map((item, idx) => (
                    <div 
                      key={idx}
                      className={cn(
                        "p-2 rounded-xl text-xs flex flex-col justify-between border",
                        item.status === 'correct' 
                          ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20" 
                          : item.status === 'incorrect'
                            ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
                            : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                      )}
                    >
                      <div className="flex justify-between font-bold opacity-60 mb-1">
                        <span># {item.cardIndex}</span>
                        <span className="uppercase text-[9px] tracking-wider">
                          {item.status === 'correct' ? 'Đúng' : item.status === 'incorrect' ? 'Sai' : 'Bỏ qua'}
                        </span>
                      </div>
                      <p className="truncate font-semibold text-stone-800 dark:text-stone-200" title={item.front}>
                        {item.front}
                      </p>
                      <div className="mt-1 flex justify-between text-[10px] border-t border-black/5 dark:border-white/5 pt-1 font-mono">
                        <span>Tỉ lệ: {item.accuracy}%</span>
                        <span className="font-bold">
                          {item.masteryChange > 0 ? `+${item.masteryChange}` : item.masteryChange} M
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>

          {/* Performance Benchmark Card */}
          <div className="bg-stone-200/40 dark:bg-zinc-800/20 p-6 rounded-3xl border border-stone-200 dark:border-zinc-800/80 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-300 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-xl">
                  <BarChart3 className="w-5 h-5 px-0.5" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-800 dark:text-stone-100 text-lg font-display">Bảng So Sánh Chỉ Số Thông Thạo (Benchmarks)</h3>
                  <p className="text-xs text-stone-500 dark:text-stone-400">Đo lường sự tiến bộ của phiên này đối với phong độ thông thạo hàng tuần của bạn</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {deltaMastery >= 0 ? (
                  <span className="inline-flex items-center gap-1 bg-green-500/10 text-green-700 dark:text-green-400 text-xs font-bold px-3 py-1.5 rounded-full border border-green-500/20">
                    ▲ Vượt chỉ số tuần: +{deltaMastery}%
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-bold px-3 py-1.5 rounded-full border border-amber-500/20">
                    ▼ Dưới chỉ số tuần: {deltaMastery}%
                  </span>
                )}
              </div>
            </div>

            {/* Benchmark Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Card 1: Current Session average card */}
              <div className="bg-stone-300/40 dark:bg-zinc-900/40 p-5 rounded-2xl border border-stone-400/10 dark:border-zinc-800 flex flex-col justify-between">
                <div>
                  <span className="text-xs uppercase font-bold text-stone-500 dark:text-stone-400">Phiên học này</span>
                  <div className="text-4xl font-extrabold font-display text-transparent bg-clip-text bg-gradient-to-r from-yellow-600 to-amber-500 dark:from-yellow-400 dark:to-amber-300 mt-1">
                    {sessionCardsMasteryAvg}%
                  </div>
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-2 leading-relaxed">
                    Mức độ thông thạo trung bình các thẻ đã trả lời trong phiên này.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-black/5 dark:border-white/5 flex items-center justify-between text-xs font-bold opacity-75">
                  <span>Đánh giá:</span>
                  <span className={cn(
                    sessionCardsMasteryAvg >= 80 ? "text-green-600 dark:text-green-400" :
                    sessionCardsMasteryAvg >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-500"
                  )}>
                    {sessionCardsMasteryAvg >= 80 ? "Xuất sắc (80%+)" :
                     sessionCardsMasteryAvg >= 50 ? "Khá giỏi (50%+)" : "Cần rèn luyện thêm"}
                  </span>
                </div>
              </div>

              {/* Card 2: Weekly average card */}
              <div className="bg-stone-300/40 dark:bg-zinc-900/40 p-5 rounded-2xl border border-stone-400/10 dark:border-zinc-800 flex flex-col justify-between">
                <div>
                  <span className="text-xs uppercase font-bold text-stone-500 dark:text-stone-400">Chỉ số Trung Bình Tuần</span>
                  <div className="text-4xl font-extrabold font-display text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-500 dark:from-blue-400 dark:to-indigo-300 mt-1">
                    {weeklyAvgMastery}%
                  </div>
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-2 leading-relaxed">
                    Phong độ thông thạo bao gồm tất cả các thẻ bạn đã ôn trong tuần qua.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-black/5 dark:border-white/5 flex items-center justify-between text-xs font-bold opacity-75">
                  <span>Trạng thái tuần:</span>
                  <span className="text-green-600 dark:text-green-400 flex items-center gap-0.5">
                    Tăng trưởng ổn định
                  </span>
                </div>
              </div>

              {/* Card 3: Comparison and performance advice card */}
              <div className="bg-stone-300/40 dark:bg-zinc-900/40 p-5 rounded-2xl border border-stone-400/10 dark:border-zinc-800 flex flex-col justify-between">
                <div>
                  <span className="text-xs uppercase font-bold text-stone-500 dark:text-stone-400">Phân Tích & Gợi Ý</span>
                  <div className="mt-2">
                    <p className="text-xs text-stone-700 dark:text-stone-300 leading-relaxed font-semibold">
                      {deltaMastery > 0 
                        ? `🎉 Thật tuyệt vời! Phiên học này của bạn vượt mức trung bình tuần (+${deltaMastery}%). Hãy luôn giữ nhịp độ này để bứt phá học tập!`
                        : deltaMastery === 0 
                          ? `📈 Phong độ rất tốt! Chỉ số thông thạo phiên hôm nay khớp hoàn hảo với trung bình hoạt động tuần trước.`
                          : `💪 Chưa đạt trung bình tuần (thấp hơn ${Math.abs(deltaMastery)}%). Cố gắng rèn luyện lại với nút "Ôn tập thẻ X" để bứt phá điểm số!`
                      }
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="w-full bg-stone-300 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        deltaMastery >= 0 ? "bg-green-500" : "bg-amber-500"
                      )}
                      style={{ width: `${Math.min(100, Math.max(10, 50 + deltaMastery * 2))}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between text-[9px] text-stone-500 dark:text-stone-400 font-bold mt-1 uppercase font-mono tracking-wider">
                    <span>Thấp hơn</span>
                    <span>Tương đương</span>
                    <span>Vượt trội</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Visual comparative bar scale */}
            <div className="bg-stone-300/20 dark:bg-zinc-900/20 p-4 rounded-2xl border border-stone-400/5 dark:border-zinc-800/50 space-y-4">
              <span className="text-xs uppercase font-bold text-stone-500 dark:text-stone-400 block mb-1">Thang So Sánh Điểm Số Trực Quan (%)</span>
              <div className="space-y-4">
                {/* Current Session Bar */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-stone-700 dark:text-stone-300 font-medium">Chỉ số Thông Thạo Phiên Học Nay</span>
                    <span className="font-extrabold text-amber-600 dark:text-yellow-400">{sessionCardsMasteryAvg}%</span>
                  </div>
                  <div className="w-full bg-stone-300/50 dark:bg-zinc-850 h-2.5 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${sessionCardsMasteryAvg}%` }}></div>
                  </div>
                </div>

                {/* Weekly Average Bar */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-stone-700 dark:text-stone-300 font-medium">Chỉ số Trung Bình Hoạt Động Tuần (Weekly Average Benchmark)</span>
                    <span className="font-extrabold text-blue-600 dark:text-blue-400">{weeklyAvgMastery}%</span>
                  </div>
                  <div className="w-full bg-stone-300/50 dark:bg-zinc-850 h-2.5 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${weeklyAvgMastery}%` }}></div>
                  </div>
                </div>

                {/* Current Deck Bar */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-stone-700 dark:text-stone-300 font-medium">Chỉ số Thông Thạo Của Bộ Thẻ Đang Học (Deck Average)</span>
                    <span className="font-extrabold text-zinc-650 dark:text-stone-400">{currentDeckMasteryAvg}%</span>
                  </div>
                  <div className="w-full bg-stone-300/50 dark:bg-zinc-850 h-2.5 rounded-full overflow-hidden">
                    <div className="h-full bg-stone-400/60 dark:bg-zinc-600 rounded-full" style={{ width: `${currentDeckMasteryAvg}%` }}></div>
                  </div>
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>
    );
  }

  if (isLoading) return (
     <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-stone-500">
         <div className="w-8 h-8 rounded-full border-4 border-amber-500 border-t-transparent animate-spin" />
         <div>Đang tải phòng học...</div>
     </div>
  );
  
  if (!deck) return (
     <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
         <div>Không tìm thấy bộ thẻ (Deck not found).</div>
         <Link to="/dashboard" className="px-6 py-2 rounded-lg bg-yellow-500 text-black font-bold hover:bg-yellow-600 transition">Về Dashboard</Link>
     </div>
  );

  if (!currentCard || studyQueue.length === 0) return (
     <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
       <div>No cards in this view.</div>
       <button onClick={startReviewAll} className="px-6 py-2 rounded-lg bg-yellow-500 text-black font-bold hover:bg-yellow-600 transition">Quay lại bộ đầy đủ</button>
     </div>
  );

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Link to="/dashboard" className="flex items-center gap-2 opacity-60 hover:opacity-100 transition w-fit">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
          
          {showRemindToast && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg font-bold text-sm animate-in slide-in-from-top flex items-center gap-2">
              <BellPlus className="w-4 h-4" />
              Đã lưu vào danh sách nhắc nhở!
            </div>
          )}

          <button onClick={handleToggleMute} className="p-2 bg-stone-200/60 dark:bg-zinc-800/50 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition" title={muted ? "Unmute sounds" : "Mute sounds"}>
            {muted ? <VolumeX className="w-4 h-4 text-red-500" /> : <Volume2 className="w-4 h-4 opacity-70" />}
          </button>
          <div className="flex items-center gap-2 bg-stone-200/60 dark:bg-zinc-800/50 px-3 py-1.5 rounded-full border border-amber-600/10 dark:border-amber-500/10">
            <Clock className="w-4 h-4 opacity-70" />
            <span className="font-mono font-bold text-sm min-w-[40px] text-center">
              {formatTime(timerSeconds)}
            </span>
            <button onClick={toggleTimer} className="hover:text-yellow-600 dark:hover:text-yellow-400 transition" title={isTimerRunning ? "Pause Timer" : "Start Pomodoro"}>
              {isTimerRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            {isTimerFinished && (
              <span className="text-xs text-green-500 font-bold animate-pulse ml-1 text-[10px] uppercase">
                +25pts!
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
           <button onClick={handleExportDeck} className="p-2 bg-stone-200/60 dark:bg-zinc-800/50 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition text-stone-600 dark:text-stone-300" title="Xuất bộ thẻ (JSON)">
             <Download className="w-4 h-4" />
           </button>
           <button onClick={startReviewAll} className={cn("px-3 py-1 rounded text-sm font-bold transition", studyMode === "all" ? "bg-yellow-500 text-black shadow" : "bg-stone-200/60 dark:bg-zinc-800/50 opacity-70")}>Tất cả</button>
           <button onClick={startReviewXCards} className={cn("px-3 py-1 rounded text-sm font-bold transition flex items-center gap-1", studyMode === "weak" ? "bg-red-500 text-white shadow" : "bg-stone-200/60 dark:bg-zinc-800/50 opacity-70")}>
              Thẻ X <span className="bg-black/20 px-1.5 rounded-full text-xs">{weakCardIds.length}</span>
           </button>
        </div>
      </div>
      
      <div className="flex justify-between items-center text-sm font-mono opacity-60 px-2">
         <span>Card {currentIndex + 1} of {studyQueue.length}</span>
         <span>Sub: {currentCard.subject}</span>
      </div>

      <div className="perspective-1000 relative w-full h-80 cursor-pointer group" onClick={handleFlip}>
        <div className={cn("w-full h-full transition-all duration-500 transform-style-3d rounded-3xl", isFlipped ? "[transform:rotateY(180deg)]" : "")}>
          {/* Front */}
          <div className="absolute inset-0 backface-hidden glass rounded-3xl text-center h-full">
            <div className="w-full h-full flex flex-col items-center justify-center p-8">
              {user?.role === "teacher" && !isEditing && (
                 <button onClick={handleEditOpen} className="absolute top-4 right-4 z-20 p-2 bg-stone-300/60 dark:bg-zinc-800/80 rounded-full hover:bg-black/20 dark:hover:bg-white/20 transition">
                   <Edit3 className="w-5 h-5 text-blue-500" />
                 </button>
              )}
              {!isEditing ? (
                <h2 className="text-4xl font-display font-semibold text-center">{currentCard?.front || "⚠️ Lỗi: Không có mặt trước"}</h2>
              ) : (
                <div className="w-full space-y-4" onClick={e => e.stopPropagation()}>
                  <textarea 
                    className="w-full p-4 rounded-xl bg-stone-200/60 dark:bg-zinc-800/50 border border-amber-600/20 dark:border-amber-500/30 resize-none outline-none focus:ring-2 focus:ring-blue-500 transition text-stone-900 dark:text-stone-100 text-center" 
                    value={editFront} 
                    onChange={e => setEditFront(e.target.value)} 
                    placeholder="Mặt trước..." 
                    rows={2} 
                  />
                  <textarea 
                    className="w-full p-4 rounded-xl bg-stone-200/60 dark:bg-zinc-800/50 border border-amber-600/20 dark:border-amber-500/30 resize-none outline-none focus:ring-2 focus:ring-blue-500 transition text-stone-900 dark:text-stone-100 text-sm text-center" 
                    value={editBack} 
                    onChange={e => setEditBack(e.target.value)} 
                    placeholder="Mặt sau..." 
                    rows={3} 
                  />
                  <button onClick={handleSaveEdit} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold w-full hover:bg-blue-700 transition">Lưu Thay Đổi</button>
                </div>
              )}
            </div>
          </div>
          {/* Back */}
          <div className="absolute inset-0 backface-hidden [transform:rotateY(180deg)] glass rounded-3xl text-center h-full">
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-lg opacity-80 overflow-y-auto">
              {user?.role === "teacher" && !isEditing && (
                 <button onClick={handleEditOpen} className="absolute top-4 right-4 z-20 p-2 bg-stone-300/60 dark:bg-zinc-800/80 rounded-full hover:bg-black/20 dark:hover:bg-white/20 transition">
                   <Edit3 className="w-5 h-5 text-blue-500" />
                 </button>
              )}
              {!isEditing ? (
              <p>{currentCard?.back || "⚠️ Lỗi: Không có mặt sau"}</p>
            ) : (
              <div className="w-full space-y-4 bg-white dark:bg-black/90 p-4 rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
                <textarea 
                  className="w-full p-3 rounded-xl bg-stone-200/60 dark:bg-zinc-800/50 border border-amber-600/20 dark:border-amber-500/30 resize-none outline-none focus:ring-2 focus:ring-blue-500 transition text-stone-900 dark:text-stone-100 text-base" 
                  value={editFront} 
                  onChange={e => setEditFront(e.target.value)} 
                  placeholder="Mặt trước..." 
                  rows={2} 
                />
                <textarea 
                  className="w-full p-3 rounded-xl bg-stone-200/60 dark:bg-zinc-800/50 border border-amber-600/20 dark:border-amber-500/30 resize-none outline-none focus:ring-2 focus:ring-blue-500 transition text-stone-900 dark:text-stone-100 text-sm" 
                  value={editBack} 
                  onChange={e => setEditBack(e.target.value)} 
                  placeholder="Mặt sau..." 
                  rows={3} 
                />
                <button onClick={handleSaveEdit} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold w-full hover:bg-blue-700 transition">Lưu Thay Đổi</button>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 pt-4">
        {/* Agent 2 Deep Extract Button */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
             {(!deepExplanation || isPinned) && (
               <button 
                 onClick={handleAgent2} 
                 disabled={isExtracting || cooldownRemaining > 0} 
                 className={cn(
                   "w-full flex items-center justify-center gap-2 p-3 glass rounded-xl text-md font-bold border border-yellow-500/30 hover:border-yellow-500 hover:bg-yellow-500/10 transition text-yellow-700 dark:text-yellow-400 shadow-sm",
                   cooldownRemaining > 0 && "opacity-50 cursor-not-allowed border-yellow-500/10"
                 )}
               >
                 <Sparkles className={cn("w-5 h-5 text-yellow-500", cooldownRemaining > 0 && "animate-pulse")} />
                 {isExtracting 
                   ? "Đang Bóc Tách Chuyên Sâu..." 
                   : cooldownRemaining > 0 
                     ? `Sạc năng lượng AI (Chờ ${cooldownRemaining}s)...` 
                     : "Bóc Tách Sâu (Agent 2)"}
               </button>
             )}
             
             {deepExplanation && (
               <div className={cn(
                 "text-base animate-in fade-in leading-relaxed border-t-4 border-yellow-500 shadow-lg bg-gradient-to-b from-yellow-500/10 to-background",
                 isSerif ? "font-serif" : "font-sans",
                 isPinned 
                   ? (isMinimized 
                       ? "fixed bottom-4 right-4 z-50 w-auto glass px-6 py-3 rounded-full cursor-pointer hover:scale-105 transition-transform" 
                       : "fixed bottom-4 right-4 z-50 w-[90%] md:w-96 max-h-[70vh] overflow-y-auto glass p-6 rounded-2xl shadow-2xl") 
                   : "glass p-6 xl:p-8 rounded-xl mt-4"
               )}
               onClick={() => { if (isPinned && isMinimized) setIsMinimized(false); }}
               >
                 {isPinned && isMinimized ? (
                    <div className="flex items-center justify-center font-bold text-yellow-600 dark:text-yellow-400 gap-2">
                       <Sparkles className="w-4 h-4" /> 
                       <span>Agent 2</span>
                       <Maximize2 className="w-4 h-4 ml-2" />
                    </div>
                 ) : (
                    <>
                      <div className="flex justify-between items-center mb-4 pb-2 border-b border-amber-600/20 dark:border-amber-500/30 sticky top-0 bg-background/80 backdrop-blur-md z-10 p-2 -mx-2 -mt-2">
                         <span className="font-bold flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                             <Sparkles className="w-5 h-5" />
                             Agent 2
                         </span>
                         <div className="flex items-center gap-1">
                             <button onClick={(e) => { e.stopPropagation(); setIsSerif(!isSerif); }} className="p-2 bg-stone-200/60 dark:bg-zinc-800/50 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition" title="Toggle Font">
                                <Type className="w-4 h-4" />
                             </button>
                             <button onClick={(e) => { e.stopPropagation(); setIsPinned(!isPinned); if (isPinned) setIsMinimized(false); }} className={cn("p-2 rounded-lg transition", isPinned ? "bg-yellow-500 text-black shadow-sm" : "bg-stone-200/60 dark:bg-zinc-800/50 hover:bg-black/10 dark:hover:bg-white/10")} title={isPinned ? "Unpin" : "Pin"}>
                                {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                             </button>
                             {isPinned && (
                                 <button onClick={(e) => { e.stopPropagation(); setIsMinimized(true); }} className="p-2 bg-stone-200/60 dark:bg-zinc-800/50 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition" title="Minimize">
                                     <Minimize2 className="w-4 h-4" />
                                 </button>
                             )}
                         </div>
                      </div>
                      <div className="markdown-body opacity-95">
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{deepExplanation}</ReactMarkdown>
                      </div>
                    </>
                 )}
               </div>
             )}
        </div>

        {/* Buttons now ALWAYS SHOW on both front and back sides */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 border-t border-amber-600/20 dark:border-amber-500/30 pt-4 mt-2">
          <div className="flex justify-center gap-6 md:gap-8 items-center">
            <button onClick={() => handleMark(false)} title="Chưa thuộc (Đánh dấu X)" className="w-16 h-16 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition shadow-sm hover:scale-105 active:scale-95">
              <X className="w-8 h-8" />
            </button>
            <button onClick={handleRemindLater} title="Remind me later (Nhắc lại sau)" className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center hover:bg-blue-500 hover:text-white transition shadow-sm hover:scale-105 active:scale-95 mt-4">
              <BellPlus className="w-5 h-5" />
            </button>
            <button onClick={() => handleMark(true)} title="Đã thuộc (Đánh dấu Check)" className="w-16 h-16 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center hover:bg-green-500 hover:text-white transition shadow-sm hover:scale-105 active:scale-95">
              <Check className="w-8 h-8" />
            </button>
          </div>
        </div>
      </div>

      {/* MỚI: FLASHCARD LIST MANAGER FOR TEACHER & ADMIN */}
      {(user?.role === "teacher" || user?.role === "admin") && (
        <div className="glass p-6 rounded-2xl border border-stone-200 dark:border-zinc-800 mt-12 animate-in fade-in slide-in-from-bottom-8 duration-300">
          <div className="flex justify-between items-center mb-6 pb-2 border-b border-stone-200 dark:border-zinc-850">
            <div>
              <h3 className="text-lg font-bold font-display flex items-center gap-2 text-stone-800 dark:text-stone-100">
                <BrainCircuit className="w-5 h-5 text-yellow-500" /> Quản lý danh sách Thẻ ({deck?.cards.length})
              </h3>
              <p className="text-xs opacity-60">Dành cho Giáo viên & Quản trị viên</p>
            </div>
            <button 
              onClick={handleAddCard}
              disabled={isUpdatingCard}
              className="flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-600 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" /> Thêm thẻ học
            </button>
          </div>

          {editSuccessMessage && (
            <div className="mb-4 bg-green-500/10 text-green-600 dark:text-green-400 p-3 rounded-lg text-xs font-semibold flex items-center gap-2 border border-green-500/20">
              <Check className="w-4 h-4 animate-bounce" /> {editSuccessMessage}
            </div>
          )}

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {deck?.cards.map((c, i) => (
              <div 
                key={c.id} 
                className="p-3 bg-stone-100/60 dark:bg-zinc-800/40 rounded-xl border border-stone-200/50 dark:border-zinc-700/30 flex justify-between items-start gap-4 hover:border-amber-500/25 transition group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold font-mono opacity-50 mb-1">Thẻ #{i + 1}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-stone-800 dark:text-stone-200">
                    <div>
                      <span className="font-bold text-xs uppercase opacity-40 block">Mặt trước:</span>
                      <p className="line-clamp-2">{c.front}</p>
                    </div>
                    <div>
                      <span className="font-bold text-xs uppercase opacity-40 block">Mặt sau:</span>
                      <p className="line-clamp-2 opacity-80">{c.back}</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      const indexInQueue = studyQueue.findIndex(qCard => qCard.id === c.id);
                      if (indexInQueue !== -1) {
                        setCurrentIndex(indexInQueue);
                        setIsFlipped(false);
                      }
                    }}
                    className="p-1.5 rounded-md hover:bg-stone-200 dark:hover:bg-zinc-700 opacity-60 hover:opacity-100 transition"
                    title="Học thẻ này"
                  >
                    <Play className="w-4 h-4 text-green-500" />
                  </button>
                  <button
                    onClick={() => {
                      const indexInQueue = studyQueue.findIndex(qCard => qCard.id === c.id);
                      if (indexInQueue !== -1) {
                        setCurrentIndex(indexInQueue);
                      }
                      setEditFront(c.front);
                      setEditBack(c.back);
                      setIsEditing(true);
                      window.scrollTo({ top: 300, behavior: 'smooth' });
                    }}
                    className="p-1.5 rounded-md hover:bg-stone-200 dark:hover:bg-zinc-700 opacity-60 hover:opacity-100 transition"
                    title="Chỉnh sửa nhanh"
                  >
                    <Edit3 className="w-4 h-4 text-blue-500" />
                  </button>
                  <button
                    onClick={() => handleRemoveCard(c)}
                    disabled={isUpdatingCard}
                    className="p-1.5 rounded-md hover:bg-red-500/10 text-red-500 opacity-60 hover:opacity-100 transition disabled:opacity-30"
                    title="Xóa thẻ học"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
