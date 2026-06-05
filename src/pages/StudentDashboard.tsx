import React, { useState, useEffect, useRef } from "react";
import { store, Deck } from "../lib/store";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Play, TrendingUp, Users, Target, BookOpen, BrainCircuit, Activity, Flame, ArrowLeft, CheckCircle2, XCircle, ArrowRight, Loader2, Trophy, Sparkles, Maximize2, Minimize2, Bell, BellOff, BellRing, Settings, AlertTriangle, Trash2, Snowflake, Volume2, VolumeX, Clock, Network, Award } from "lucide-react";
import { MarcusAureliusIcon } from "../components/MarcusAureliusIcon";
import { cn } from "../lib/utils";
import { safeRequest } from "../utils/apiClient";
import { db, auth, handleFirestoreError, OperationType } from "../lib/firebase";
import { collection, doc, onSnapshot, query, where, getDocs, updateDoc, arrayUnion, arrayRemove, limit } from "firebase/firestore";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "motion/react";
import { getIsMuted, setMutedStatus } from "../lib/audio";
import { MasteryBubbleChart } from "../components/MasteryBubbleChart";
import { MasteryHeatmap } from "../components/MasteryHeatmap";
import { SkillTreeGraph } from "../components/SkillTreeGraph";
import { StudentBadges } from "../components/StudentBadges";
// Removed import

import { DeckList } from "../components/DeckList";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useAICooldown } from "../lib/cooldown";
import { useSound } from "../hooks/useSound";
import { triggerCelebration } from "../lib/celebration";

function AnimatedCounter({ value }: { value: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest));

  useEffect(() => {
    const animation = animate(count, value, { duration: 1, ease: "easeOut" });
    return animation.stop;
  }, [value]);

  return <motion.span>{rounded}</motion.span>;
}

// Confetti component removed

type QuizQuestion = {
  cardId?: string;
  deckId?: string;
  question: string;
  options: string[];
  correctAnswerIndex?: number;
  correctIndex?: number;
  correctAnswer?: string;
  explanation?: string;
};

const MOTIVATION_QUOTES = [
  "Virtue is nothing else than right reason. - Seneca",
  "We suffer more often in imagination than in reality. - Seneca",
  "Waste no more time arguing what a good man should be. Be one. - Marcus Aurelius",
  "He who fears death will never do anything worth of a man who is alive. - Seneca",
  "The impediment to action advances action. What stands in the way becomes the way. - Marcus Aurelius",
  "It is not because things are difficult that we do not dare; it is because we do not dare that they are difficult. - Seneca",
  "Well begun is half done. - Aristotle",
  "Discipline is the bridge between goals and accomplishment. - Jim Rohn",
  "The struggle you’re in today is developing the strength you need for tomorrow. - Robert Tew",
  "If you want to live a happy life, tie it to a goal, not to people or things. - Albert Einstein",
  "Success is not final, failure is not fatal: it is the courage to continue that counts. - Winston Churchill",
  "It is better to conquer yourself than to win a thousand battles. - Buddha",
  "Mastery is not a destination, but a journey of continuous improvement. - Unknown",
  "Growth is painful. Change is painful. But nothing is as painful as staying stuck where you don't belong. - Mandy Hale",
  "Your potential is endless. Go do what you were created to do. - Dharma Mittra",
  "The secret of getting ahead is getting started. - Mark Twain",
  "Persistence guarantees that results are inevitable. - Paramahansa Yogananda",
  "Do what you can, with what you have, where you are. - Theodore Roosevelt",
  "The master has failed more times than the beginner has even tried. - Stephen McCranie",
  "Quality is not an act, it is a habit. - Aristotle"
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="card-3d p-4 rounded-2xl">
        <p className="font-medium text-xs tracking-widest uppercase text-zinc-500 dark:text-zinc-400 mb-1.5">{label}</p>
        <div className="flex items-baseline gap-1.5">
          <p className="font-display font-bold text-2xl text-yellow-600 dark:text-yellow-500 leading-none">
            {payload[0].value}
          </p>
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">pts</span>
        </div>
      </div>
    );
  }
  return null;
};

export default function StudentDashboard() {
  useEffect(() => {
    document.title = "Henosis - Student Dashboard";
  }, []);

  const { click, success, error } = useSound();
  const user = store.getCurrentUser();

  const [localDecks, setLocalDecks] = useState<Deck[]>(() => store.getDecks());
  const [quote] = useState(() => MOTIVATION_QUOTES[Math.floor(Math.random() * MOTIVATION_QUOTES.length)]);
  const decks = localDecks;
  
  const [activeTab, setActiveTab] = useState<"study" | "ranking" | "quiz" | "mock_exam_setup" | "settings" | "history" | "skill_tree" | "all_sets" | "groups" | "achievements">("study");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
// Removed unused state
  const [muteAll, setMuteAll] = useState(() => getIsMuted());
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("henosis_notifications");
      return saved === "true";
    }
    return false;
  });
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<"7_days" | "30_days" | "all_time">("7_days");

  const [rawDecks, setRawDecks] = useState<Deck[]>([]);
  const [personalCardStates, setPersonalCardStates] = useState<any[]>([]);
  const [joinStatus, setJoinStatus] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const navigate = useNavigate();
  const [isStartingQuest, setIsStartingQuest] = useState(false);

  const handleStartDailyQuest = async () => {
    setIsStartingQuest(true);
    try {
      const allDecks = store.getDecks();
      let allCards: any[] = [];
      allDecks.forEach(d => {
         d.cards.forEach((c: any) => {
            allCards.push({ ...c, originDeckId: d.id, originDeckTitle: d.title });
         });
      });

      if (allCards.length === 0) {
        alert("Không có thẻ nào để tạo nhiệm vụ!");
        setIsStartingQuest(false);
        return;
      }

      const res = await safeRequest("/api/daily-quest", {
         headers: { "Content-Type": "application/json" },
         method: "POST",
         body: JSON.stringify({ allCards })
      });

      const data = await res.json();

      if (!data.cards || data.cards.length === 0) {
        alert("Chưa có thẻ nào cần ôn hôm nay!");
        setIsStartingQuest(false);
        return;
      }

      const dailyDeck = {
         id: "daily-quest",
         title: "Nhiệm vụ hôm nay (Daily Quest)",
         subject: "Spaced Repetition",
         description: "Được tự động tạo bởi SM-2 bằng Thuật toán phân cực.",
         cards: data.cards,
         createdAt: new Date().toISOString(),
         ownerId: "system"
      };

      store.setTempDeck(dailyDeck);
      navigate("/study/daily-quest");
    } catch(err) {
       console.error("Daily quest start error:", err);
       alert("Có lỗi khi tạo lộ trình hôm nay. Vui lòng thử lại.");
       setIsStartingQuest(false);
    }
  };

  // 1. Listen to raw decks in real-time
  const unsubDecksRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!user) return;
    if (unsubDecksRef.current) unsubDecksRef.current();
    try {
      unsubDecksRef.current = onSnapshot(collection(db, "sets"), (snapshot) => {
        const list: Deck[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data && Array.isArray(data.cards)) {
             data.cards = data.cards.map((c: any) => ({
                ...c,
                mastery: (typeof c.mastery === 'number' && !isNaN(c.mastery)) ? c.mastery : 0
             }));
          }
          list.push(data as Deck);
        });
        setRawDecks(list);
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, "sets");
      });
    } catch (e) {
      console.error("Failed to sync sets in real-time:", e);
    }
    return () => {
      if (unsubDecksRef.current) unsubDecksRef.current();
    };
  }, [user?.id]);

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
        console.error("Personal cardsState sync error:", err);
      });
    } catch (e) {
      console.error("Failed to sync card states in real-time:", e);
    }
    return () => {
      if (unsubCardStatesRef.current) unsubCardStatesRef.current();
    };
  }, [user?.id]);

  // 3. Merge raw decks and personal card states to form localDecks and store
  useEffect(() => {
    if (rawDecks.length === 0) return;

    const stateMap = new Map();
    if (personalCardStates && personalCardStates.length > 0) {
      personalCardStates.forEach((s) => stateMap.set(s.id, s));
    }

    const mergedDecks = rawDecks.map((deck) => {
      const clonedDeck = { ...deck };
      if (clonedDeck.cards) {
        clonedDeck.cards = clonedDeck.cards.map((card) => {
          const savedState = stateMap.get(card.id);
          if (savedState) {
            return {
              ...card,
              mastery: typeof savedState.mastery === 'number' && !isNaN(savedState.mastery) ? savedState.mastery : (Number(card.mastery) || 0),
              nextReviewDate: typeof savedState.nextReviewDate === 'number' ? savedState.nextReviewDate : card.nextReviewDate,
              nextReview: typeof savedState.nextReview === 'number' ? savedState.nextReview : card.nextReview,
              interval: typeof savedState.interval === 'number' ? savedState.interval : card.interval,
              repetitionCount: typeof savedState.repetitionCount === 'number' ? savedState.repetitionCount : card.repetitionCount,
              easeFactor: typeof savedState.easeFactor === 'number' ? savedState.easeFactor : card.easeFactor,
              isNewCard: typeof savedState.isNewCard === 'boolean' ? savedState.isNewCard : false,
              isHard: typeof savedState.isWeakCard !== 'undefined' ? savedState.isWeakCard : card.isHard
            };
          }
          return card;
        });
      }
      return clonedDeck;
    });

    const updateStore = async () => {
      const { store: globalStore } = await import("../lib/store");
      if (globalStore && typeof (globalStore as any).setDecksLocally === 'function') {
         (globalStore as any).setDecksLocally(mergedDecks);
      }
    };
    updateStore();
    setLocalDecks(mergedDecks);
  }, [rawDecks, personalCardStates]);

  const [dbUsers, setDbUsers] = useState<any[]>([]);

  // Listen for real-time changes to the users collection (leaderboard & points sync)
  const unsubUsersRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!user) return;
    if (unsubUsersRef.current) unsubUsersRef.current();
    try {
      const q = query(collection(db, "users"), where("points", ">", 0), limit(100));
      unsubUsersRef.current = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() });
        });
        setDbUsers(list);
        
        // Dynamic synchronization with the global store
        if (user) {
          const matched = list.find((u) => u.id === user.id);
          if (matched) {
            // Deep Comparison Guard to block infinite cascading re-renders
            if (JSON.stringify(user) !== JSON.stringify(matched)) {
                store.updateCurrentUser(matched);
            }
          }
        }
      }, (err) => {
        console.error("Leaderboard query error:", err);
      });
    } catch (e) {
      console.error(e);
    }
    return () => {
      if (unsubUsersRef.current) unsubUsersRef.current();
    };
  }, [user?.id]);

  // Listen for real-time changes to the active group, fetching and sorting member profiles dynamically
  useEffect(() => {
    // Group functionality removed
    return () => {};
  }, [user?.id]);

  const sortedUsers = dbUsers.length > 0
    ? dbUsers.filter(u => u.role === "student" && u.status !== "disabled" && u.isAnonymous !== true && u.name !== "Guest Student" && (u.points || 0) > 0).sort((a, b) => (b.points || 0) - (a.points || 0))
    : [...store.getUsers()].filter(u => u.role === "student" && u.isAnonymous !== true && u.name !== "Guest Student" && (u.points || 0) > 0).sort((a, b) => b.points - a.points);
  
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [activeGroup, setActiveGroup] = useState<any>(null);
  
  const handleCreateGroup = () => {
    if (groupName.trim()) {
        const g = store.createGroup(groupName);
        setActiveGroup(g);
        setGroupName("");
    }
  };
  
  const handleJoinGroup = () => {
    if (groupId.trim()) {
        const g = store.joinGroup(groupId);
        if (g) setActiveGroup(g);
    }
  };
  
  const handleLeaveGroup = () => {
     setActiveGroup(null);
  };
  
  const [studentToDelete, setStudentToDelete] = useState<any | null>(null);
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"hard" | "soft">("hard");

  const handleDeleteStudentSubmit = async () => {
    if (!studentToDelete) return;
    setIsDeletingStudent(true);
    try {
      const { dbService } = await import("../lib/firebase");
      if (deleteMode === "hard") {
        await dbService.deleteUserProfile(studentToDelete.id);
        setDbUsers(prev => prev.filter(u => u.id !== studentToDelete.id));
      } else {
        await dbService.updateUserProfile(studentToDelete.id, { status: "disabled" });
        setDbUsers(prev => prev.map(u => u.id === studentToDelete.id ? { ...u, status: "disabled" } : u));
      }
      setStudentToDelete(null);
    } catch (e: any) {
      console.error("Error deleting student:", e);
    } finally {
      setIsDeletingStudent(false);
    }
  };
  
  // --- Weekly Study Time Calculation ---
  const calculateWeeklyStudyHours = () => {
    if (!user) return { hours: 0, minutes: 0 };
    const history = store.getReviewHistory(user.id);
    if (!history || history.length === 0) return { hours: 0, minutes: 0 };

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklyHistory = history.filter(r => r.timestamp >= oneWeekAgo).sort((a, b) => a.timestamp - b.timestamp);

    let totalMilliseconds = 0;
    const NEW_SESSION_THRESHOLD = 5 * 60 * 1000; // 5 minutes break = new session
    const DEFAULT_CARD_TIME = 15 * 1000; // 15 seconds for the first card of a session

    for (let i = 0; i < weeklyHistory.length; i++) {
        if (i === 0) {
            totalMilliseconds += DEFAULT_CARD_TIME;
        } else {
            const diff = weeklyHistory[i].timestamp - weeklyHistory[i - 1].timestamp;
            if (diff <= NEW_SESSION_THRESHOLD) {
                totalMilliseconds += diff;
            } else {
                totalMilliseconds += DEFAULT_CARD_TIME;
            }
        }
    }

    const totalMinutes = Math.floor(totalMilliseconds / (1000 * 60));
    return {
        hours: Math.floor(totalMinutes / 60),
        minutes: totalMinutes % 60
    };
  };

  const { hours: studyHours, minutes: studyMinutes } = calculateWeeklyStudyHours();
  // -------------------------------------
  
  const remindLaterCount = (() => {
    try {
      const items = JSON.parse(localStorage.getItem("remind_later_items") || "[]");
      return items.length;
    } catch {
      return 0;
    }
  })();
  
  useEffect(() => {
    if (user?.id) {
       const key = `last_streak_${user.id}`;
       const oldStreak = parseInt(sessionStorage.getItem(key) || "0", 10);
       if (user.streak && user.streak > oldStreak) {
          triggerCelebration();
       }
       sessionStorage.setItem(key, (user.streak || 0).toString());
    }
  }, [user?.streak, user?.id]);
  
  const todayString = new Date().toISOString().split('T')[0];
  const [dailyGoal, setDailyGoal] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`daily_goal_${user?.id}`);
      return saved ? parseInt(saved, 10) : 20;
    }
    return 20;
  });
  
  const [, setForceRender] = useState(0);

  const handleBuyFreeze = () => {
    if (store.buyStreakFreeze()) {
       setForceRender(prev => prev + 1);
    }
  };

  // Note: we fetch this statically on dashboard load/render since we don't dispatch events on localstorage
  const dailyReviewed = typeof window !== "undefined" ? parseInt(localStorage.getItem(`daily_reviewed_${user?.id}_${todayString}`) || "0", 10) : 0;
  
  const handleDailyGoalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || 0;
    setDailyGoal(val);
    if (user?.id) localStorage.setItem(`daily_goal_${user.id}`, val.toString());
  };

  const pendingCardsCount = decks.reduce((acc, deck) => {
    return acc + (deck.cards || []).filter(c => c.nextReview && c.nextReview <= Date.now()).length;
  }, 0);

  const deckWithLowestMastery = React.useMemo(() => {
    const decksWithCards = decks.filter(d => d.cards && d.cards.length > 0);
    if (decksWithCards.length === 0) return null;
    
    return decksWithCards.reduce((lowest, current) => {
      const currentAvg = current.cards.reduce((sum: number, c: any) => sum + (c.mastery || 0), 0) / current.cards.length;
      const lowestAvg = lowest.cards.reduce((sum: number, c: any) => sum + (c.mastery || 0), 0) / lowest.cards.length;

      return currentAvg < lowestAvg ? current : lowest;
    }, decksWithCards[0]);
  }, [decks]);

  const toggleNotifications = () => {
    const newVal = !notificationsEnabled;
    setNotificationsEnabled(newVal);
    localStorage.setItem("henosis_notifications", newVal.toString());
  };

  const handleClearOldData = () => {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('weak_cards_') || key.includes('draft') || key.includes('agent'))) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    setShowClearConfirm(false);
    // Optionally trigger a page reload or force an update here if needed.
    window.location.reload();
  };

  
  // Quiz states
  const { cooldownRemaining, startCooldown } = useAICooldown(user);
  const [isQuizLoading, setIsQuizLoading] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizCurrentIndex, setQuizCurrentIndex] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [quizFinished, setQuizFinished] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizQuote] = useState(MOTIVATION_QUOTES[Math.floor(Math.random() * MOTIVATION_QUOTES.length)]);

  // Mock Exam specific states
  const [selectedExamDecks, setSelectedExamDecks] = useState<string[]>([]);
  const [examQuestionCount, setExamQuestionCount] = useState<number>(10);

  const triggerQuiz = async () => {
      if (cooldownRemaining > 0) return;
      
      const allDecks = store.getDecks();
      let weakCards: any[] = [];
      for (const deck of allDecks) {
        const storageKey = `weak_cards_${deck.id}`;
        const weakIds = JSON.parse(localStorage.getItem(storageKey) || "[]");
        let cards = (deck.cards || []).filter(c => weakIds.includes(c.id) || c.mastery < 50);
        weakCards.push(...cards.map(c => ({ front: c.front, back: c.back, subject: c.subject })));
      }
      
      weakCards = weakCards.sort(() => 0.5 - Math.random()).slice(0, 15);
      
      if (weakCards.length === 0) {
        setQuizError("Bạn chưa có thẻ yếu nào để thực hiện kiểm tra AI. Hãy học thêm một số Flashcard nha!");
        setTimeout(() => setQuizError(null), 3000);
        return;
      }

      if (user && user.role === "student") {
        startCooldown();
      }
      setIsQuizLoading(true);
      setActiveTab("quiz");
      setQuizError(null);
      setQuizFinished(false);
      setQuizScore(0);
      setQuizCurrentIndex(0);
      setSelectedOption(null);
      setIsAnswerRevealed(false);
      
      try {
        const idToken = await auth.currentUser?.getIdToken() || "";
        const res = await safeRequest("/api/agent3/chat", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": `Bearer ${idToken}`,
              "x-user-id": user?.id || "",
              "x-user-role": user?.role || ""
            },
            body: JSON.stringify({
                mode: "quiz",
                message: "Sinh đề kiểm tra MCQ theo format chuẩn json.",
                mcqData: weakCards,
                difficulty: "medium"
            })
        });
        
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 429) {
            throw new Error(data.error || "Bạn đang gọi AI quá nhanh. Hãy chờ 5s nạp năng lượng!");
          }
          throw new Error(data.error?.message || "Lỗi kết nối từ Hệ thống Gemini");
        }
        if (data.result) {
            let jsonText = data.result.replace(/```json/g, "").replace(/```/g, "").trim();
            const questions = JSON.parse(jsonText);
            if (!Array.isArray(questions)) throw new Error("Format không phải là mảng JSON");
            setQuizQuestions(questions);
            setIsQuizLoading(false);
        } else {
            throw new Error("Dữ liệu rỗng bất thường");
        }
      } catch (err: any) {
        console.error("Quiz Error", err);
        setQuizError("Lỗi Hệ Thống Sinh Đề AI: " + (err.message || "Vui lòng thử lại"));
        setActiveTab("study");
        setIsQuizLoading(false);
        setTimeout(() => setQuizError(null), 4000);
      }
  };

  const generateMockExam = async () => {
      if (selectedExamDecks.length === 0) {
        setQuizError("Vui lòng chọn ít nhất 1 bộ thẻ để thi!");
        setTimeout(() => setQuizError(null), 3000);
        return;
      }
      
      const allDecks = store.getDecks();
      const targetDecks = allDecks.filter(d => selectedExamDecks.includes(d.id));
      
      if (user && user.role === "student") {
        startCooldown();
      }
      setIsQuizLoading(true);
      setActiveTab("quiz");
      setQuizError(null);
      setQuizFinished(false);
      setQuizScore(0);
      setQuizCurrentIndex(0);
      setSelectedOption(null);
      setIsAnswerRevealed(false);
      
      try {
        const idToken = await auth.currentUser?.getIdToken() || "";
        const res = await safeRequest("/api/exam/generate", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": `Bearer ${idToken}`,
              "x-user-id": user?.id || "",
              "x-user-role": user?.role || ""
            },
            body: JSON.stringify({
                decks: targetDecks,
                examType: "multiple_choice",
                count: examQuestionCount
            })
        });
        
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 429) {
            throw new Error(data.error || "Bạn đang gọi AI quá nhanh. Hãy chờ 5s nạp năng lượng!");
          }
          throw new Error(data.error || "Lỗi kết nối từ Hệ thống Gemini");
        }
        if (data.result) {
            let jsonText = data.result.replace(/```json/g, "").replace(/```/g, "").trim();
            const questions = JSON.parse(jsonText);
            if (!Array.isArray(questions)) throw new Error("Format không phải là mảng JSON");
            setQuizQuestions(questions);
            setIsQuizLoading(false);
        } else {
            throw new Error("Dữ liệu rỗng bất thường");
        }
      } catch (err: any) {
        console.error("Exam Generate Error", err);
        setQuizError("Lỗi Hệ Thống Sinh Đề AI: " + (err.message || "Vui lòng thử lại"));
        setActiveTab("mock_exam_setup");
        setIsQuizLoading(false);
        setTimeout(() => setQuizError(null), 4000);
      }
  };

  const currentQ = quizQuestions[quizCurrentIndex];

  const getCorrectIndex = (q: QuizQuestion) => {
    if (q.correctAnswerIndex !== undefined) return q.correctAnswerIndex;
    if (q.correctIndex !== undefined) return q.correctIndex;
    if (q.correctAnswer) {
        const charCode = q.correctAnswer.charCodeAt(0);
        if (charCode >= 65 && charCode <= 68) return charCode - 65; // A=0, B=1...
    }
    return 0; // fallback
  };

  const handleOptionClick = (idx: number) => {
    if (isAnswerRevealed) return;
    setSelectedOption(idx);
    setIsAnswerRevealed(true);
    
    const isCorrect = idx === getCorrectIndex(currentQ);
    if (isCorrect) {
      setQuizScore(prev => prev + 1);
    }

    if (currentQ.cardId && currentQ.deckId) {
       store.updateCardMastery(currentQ.deckId, currentQ.cardId, isCorrect);
       // Phân tán ra UI reload state
       setForceRender(prev => prev + 1);
    }
  };

  const handleNextQuestion = () => {
      if (quizCurrentIndex + 1 < quizQuestions.length) {
          setQuizCurrentIndex(prev => prev + 1);
          setSelectedOption(null);
          setIsAnswerRevealed(false);
      } else {
          setQuizFinished(true);
      }
  };

  // Mock trend data
  const basePoints = user?.points || 0;
  
  const getTrendData = () => {
    if (chartPeriod === "30_days") {
       return Array.from({length: 15}).map((_, i) => ({
           day: `Day ${i * 2 + 1}`,
           points: Math.max(0, basePoints - (15 - i) * 12)
       })).concat([{ day: 'Today', points: basePoints }]);
    } else if (chartPeriod === "all_time") {
       return Array.from({length: 10}).map((_, i) => ({
           day: `Month ${i + 1}`,
           points: Math.max(0, basePoints - (10 - i) * 30)
       })).concat([{ day: 'Today', points: basePoints }]);
    } else { // 7 days
       return [
        { day: 'Day 1', points: Math.max(0, basePoints - 45) },
        { day: 'Day 2', points: Math.max(0, basePoints - 38) },
        { day: 'Day 3', points: Math.max(0, basePoints - 29) },
        { day: 'Day 4', points: Math.max(0, basePoints - 15) },
        { day: 'Day 5', points: Math.max(0, basePoints - 8) },
        { day: 'Day 6', points: Math.max(0, basePoints - 3) },
        { day: 'Today', points: basePoints },
      ];
    }
  };
  const trendData = getTrendData();

  // Calendar Days Calculation for tracking active study days
  const calendarYear = currentMonth.getFullYear();
  const calendarMonth = currentMonth.getMonth(); // 0-indexed month
  const firstDayOfMonth = new Date(calendarYear, calendarMonth, 1).getDay(); // 0 is Sunday, 1 is Monday ...
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const calendarDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Translate month names for visual display
  const monthNamesVi = [
    "Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6",
    "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"
  ];
  const calendarMonthLabel = `${monthNamesVi[calendarMonth]} ${calendarYear}`;

  // Build active study days mapping
  const activeStudyDaysSet = new Set<string>();
  if (user) {
    // Collect from actual reviewed items
    store.getReviewHistory(user.id).forEach(record => {
      const d = new Date(record.timestamp);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      activeStudyDaysSet.add(dateStr);
    });

    // We also map streak backward so the student sees their streak beautifully mapped on the calendar!
    const userStreak = user.streak || 0;
    for (let s = 0; s < userStreak; s++) {
      const d = new Date();
      d.setDate(d.getDate() - s);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      activeStudyDaysSet.add(dateStr);
    }
  }

  const navigatePrevMonth = () => {
    setCurrentMonth(new Date(calendarYear, calendarMonth - 1, 1));
  };
  const navigateNextMonth = () => {
    setCurrentMonth(new Date(calendarYear, calendarMonth + 1, 1));
  };

  // Prepare data for bubble chart
  const bubbleData = decks.map(deck => {
    const avgMastery = deck.cards?.length ? deck.cards.reduce((sum, c) => sum + (Number(c.mastery) || 0), 0) / deck.cards.length : 0;
    return {
      id: deck.id,
      label: deck.title.substring(0, 8) + (deck.title.length > 8 ? '...' : ''), // truncate long titles
      value: deck.cards?.length || 1, // weight by card count
      mastery: Math.round(avgMastery),
    };
  });

  // Prepare data for heatmap
  const heatmapData = React.useMemo(() => {
    const days = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Today'];
    const data: { deckTitle: string, day: string, mastery: number }[] = [];
    decks.forEach(deck => {
        const avgMastery = deck.cards?.length ? deck.cards.reduce((s, c) => s + (Number(c.mastery) || 0), 0) / deck.cards.length : 0;
        const shortTitle = deck.title.substring(0, 10) + (deck.title.length > 10 ? '...' : '');
        days.forEach((day, i) => {
            // Mock a decreasing mastery going backwards, so it looks like it's trending UP to 'avgMastery' Today.
            let simulatedMastery = Math.round(avgMastery - (6 - i) * Math.random() * 8);
            if (simulatedMastery < 0) simulatedMastery = 0;
            if (simulatedMastery > 100) simulatedMastery = 100;
            data.push({
                deckTitle: shortTitle,
                day: day,
                mastery: simulatedMastery
            });
        });
    });
    return data;
  }, [decks]);

  if (user?.role === "teacher") return <Navigate to="/teacher" />;
  if (!user) return <Navigate to="/" />;

  return (
    <div className="space-y-8 animate-in fade-in pb-12 relative">
      {/* Thêm Toast Thông báo Toast Thành Công */}
      {joinStatus && (
          <div className="fixed top-20 right-4 z-50 bg-green-500 text-white px-6 py-4 rounded-xl shadow-2xl animate-in slide-in-from-right-8 font-bold flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6" />
              {joinStatus}
          </div>
      )}

      {/* Thêm Toast Thông báo lỗi AI */}
      {quizError && (
          <div className="fixed top-20 right-4 z-50 bg-red-500 text-white px-6 py-4 rounded-xl shadow-2xl animate-in slide-in-from-right-8 font-bold flex items-center gap-3">
              <XCircle className="w-6 h-6" />
              {quizError}
          </div>
      )}

      <AnimatePresence mode="wait">
      {activeTab !== "quiz" && (
      <motion.section 
        key="header-stats"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
        transition={{ duration: 0.3 }}
        className="glass p-8 rounded-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <Target className="w-48 h-48" />
        </div>
        <div className="relative z-10">
          <h2 className="text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 mb-2">Salve, {user?.name}</h2>
          <p className="font-roman text-lg italic opacity-80 mb-6 min-h-[3.5rem]">{quote}</p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-4 py-2 rounded-lg font-bold flex items-center gap-2 relative">
              <TrendingUp className="w-5 h-5" />
              Weekly Points: <AnimatedCounter value={user?.points || 0} />
            </div>
            
            <div className={cn("px-4 py-2 rounded-lg font-bold flex items-center gap-2", user?.streak && user.streak > 0 ? "bg-orange-500 text-white shadow-lg shadow-orange-500/30 animate-pulse" : "bg-orange-500/20 text-orange-700 dark:text-orange-400")}>
              <Flame className={cn("w-5 h-5", user?.streak && user.streak > 0 ? "fill-current" : "")} />
              {user?.streak || 0} Day Streak 🔥
            </div>

            <button
               onClick={handleBuyFreeze}
               disabled={user?.streakFreeze || (user ? user.points < 50 : true)}
               title="Streak Freeze (Bảo vệ chuỗi ngày học) - Tốn 50 pts"
               className={cn("px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition hover:scale-105", user?.streakFreeze ? "bg-blue-500 text-white" : "bg-blue-500/20 text-blue-700 dark:text-blue-400 opacity-60 hover:opacity-100 disabled:opacity-30 disabled:hover:scale-100")}
            >
              <Snowflake className={cn("w-5 h-5", user?.streakFreeze ? "animate-pulse" : "")} />
              {user?.streakFreeze ? "Đã Kích Hoạt" : "Trang Bị (50 pts)"}
            </button>

            <button 
                onClick={() => setActiveTab("mock_exam_setup")} 
                disabled={cooldownRemaining > 0} 
                className={cn("px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-lg transition transform", cooldownRemaining > 0 ? "bg-stone-300/60 dark:bg-zinc-800/80 text-black/50 dark:text-white/50 cursor-not-allowed" : "relative overflow-hidden group bg-yellow-500 hover:bg-yellow-600 text-black shadow-lg hover:scale-[1.02] transition-all duration-500 font-bold before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/50 before:to-transparent before:-translate-x-full hover:before:translate-x-full before:transition-transform before:duration-700")}
            >
              <BrainCircuit className="w-5 h-5" />
              {cooldownRemaining > 0 ? `Đang hồi chiêu (${cooldownRemaining}s)` : "Sinh Bài Thi (Mock Exam)"}
            </button>
          </div>
        </div>
      </motion.section>
      )}


      {activeTab !== "quiz" && (
      <motion.div 
        key="tab-nav"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="flex gap-4 mb-6 border-b border-amber-600/20 dark:border-amber-500/30 pb-4 flex-wrap"
      >
        <button 
          onClick={() => setActiveTab("study")} 
          className={cn("px-4 py-2 font-bold rounded-lg transition relative", activeTab === "study" ? "bg-black dark:bg-white text-white dark:text-black" : "opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5")}
        >
          Góc Học Tập
          {remindLaterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse border-2 border-white dark:border-black"></span>
          )}
        </button>
        <button 
           onClick={() => setActiveTab("all_sets")} 
           className={cn("px-4 py-2 font-bold rounded-lg transition relative", activeTab === "all_sets" ? "bg-black dark:bg-white text-white dark:text-black" : "opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5")}
        >
          Tất Cả Bộ Học
        </button>
        <button 
          onClick={() => setActiveTab("ranking")} 
           className={cn("px-4 py-2 font-bold rounded-lg transition flex items-center gap-2", activeTab === "ranking" ? "bg-yellow-500 text-black shadow-md" : "opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5")}
        >
          <MarcusAureliusIcon className="w-5 h-5" /> Bảng Xếp Hạng Tuần
        </button>

        <button 
          onClick={() => setActiveTab("skill_tree")} 
           className={cn("px-4 py-2 font-bold rounded-lg transition flex items-center gap-2", activeTab === "skill_tree" ? "bg-amber-600 text-white shadow-md relative z-10" : "opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5")}
        >
          <Network className="w-5 h-5" /> Skill Tree
        </button>
        <button 
          onClick={() => setActiveTab("achievements")} 
           className={cn("px-4 py-2 font-bold rounded-lg transition flex items-center gap-2", activeTab === "achievements" ? "bg-emerald-600 text-white shadow-md relative z-10" : "opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5")}
        >
          <Award className="w-5 h-5" /> Thành Tựu
        </button>

        <button 
          onClick={() => setActiveTab("settings")} 
           className={cn("px-4 py-2 font-bold rounded-lg transition flex items-center gap-2", activeTab === "settings" ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-black shadow-md" : "opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5")}
        >
          <Settings className="w-5 h-5" /> Cài Đặt
        </button>
        <button 
          onClick={() => setActiveTab("history")} 
           className={cn("px-4 py-2 font-bold rounded-lg transition flex items-center gap-2", activeTab === "history" ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-black shadow-md" : "opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5")}
        >
          <Activity className="w-5 h-5" /> Lịch Sử
        </button>
      </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
      {activeTab === "achievements" && (
        <motion.div 
            key="achievements-tab"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
         >
             <StudentBadges points={user?.points || 0} streak={user?.streak || 0} />
         </motion.div>
       )}


      {activeTab === "quiz" && (
          <ErrorBoundary fallback={<div className="p-8 bg-red-100/50 rounded-lg text-center dark:bg-red-900/10">Bài thi tạm thời không khả dụng do lỗi hệ thống AI. Vui lòng quay lại sau.</div>}>
          <motion.div 
            key="quiz-tab"
            initial={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
            transition={{ duration: 0.4 }}
          >
             {isQuizLoading ? (
                 <div className="glass p-16 rounded-2xl flex flex-col items-center justify-center text-center space-y-6">
                     <Loader2 className="w-16 h-16 animate-spin text-yellow-500" />
                     <h2 className="text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-yellow-600 dark:text-yellow-400">Đang khởi tạo bài kiểm tra năng lực...</h2>
                     <p className="opacity-70 max-w-lg italic font-serif">Chuyên gia khảo thí AI đang phân tích dữ liệu hổng kiến thức của bạn để tạo 15 câu trắc nghiệm thực chiến.</p>
                     <div className="font-mono text-xl bg-stone-200/60 dark:bg-zinc-800/50 px-6 py-2 rounded-full border border-amber-600/20 dark:border-amber-500/30 font-bold text-yellow-600">
                         Cooldown: {cooldownRemaining}s
                     </div>
                 </div>
             ) : quizFinished ? (
                 <div className="glass p-12 rounded-2xl flex flex-col items-center justify-center text-center space-y-6">
                     <Trophy className="w-24 h-24 text-yellow-500 mb-4" />
                     <h2 className="text-4xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500">Tổng kết Bài Test</h2>
                     <div className="text-6xl font-mono font-bold text-yellow-600 dark:text-yellow-400 my-4">
                         {quizScore} <span className="opacity-40 text-4xl">/ {quizQuestions.length}</span>
                     </div>
                     <p className="font-roman text-xl italic opacity-80 border-l-4 border-yellow-500 pl-4 py-2">"{quizQuote}"</p>
                     
                     <div className="pt-8">
                         <button onClick={() => { setActiveTab("study"); setQuizQuestions([]); }} className="bg-black dark:bg-white text-white dark:text-black px-8 py-3 rounded-full font-bold shadow-lg hover:scale-105 transition flex items-center gap-2">
                             <ArrowLeft className="w-5 h-5" />
                             Về trang chủ Dashboard
                         </button>
                     </div>
                 </div>
             ) : (
                 <div className="glass p-8 md:p-12 rounded-2xl space-y-8 max-w-4xl mx-auto">
                     <div className="flex justify-between items-center border-b border-amber-600/20 dark:border-amber-500/30 pb-4">
                        <button onClick={() => { setActiveTab("study"); setQuizQuestions([]); }} className="opacity-60 hover:opacity-100 transition flex items-center gap-2">
                            <ArrowLeft className="w-4 h-4" /> Thoát Bài Test
                        </button>
                        <div className="font-mono bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 px-4 py-1.5 rounded-full font-bold">
                            Câu hỏi {quizCurrentIndex + 1} / {quizQuestions.length}
                        </div>
                     </div>
                     
                     <div className="min-h-[120px] flex items-center justify-center py-6">
                         <h3 className="text-2xl md:text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 leading-relaxed text-center">
                             <div className="markdown-body inline-block"><ReactMarkdown>{currentQ?.question || ""}</ReactMarkdown></div>
                         </h3>
                     </div>

                     <div className="grid md:grid-cols-2 gap-4">
                         {currentQ?.options.map((opt, i) => {
                             let optClass = "border border-amber-600/20 dark:border-amber-500/30 hover:border-yellow-500 hover:bg-yellow-500/5 bg-stone-200/60 dark:bg-zinc-800/50 opacity-90 hover:opacity-100";
                             let OptIcon = null;
                             
                             if (isAnswerRevealed) {
                                 const cIdx = getCorrectIndex(currentQ);
                                 if (i === cIdx) {
                                     optClass = "bg-green-500/20 border-green-500 text-green-900 dark:text-green-300 font-bold shadow-md ring-2 ring-green-500 scale-[1.02] transition-transform";
                                     OptIcon = <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400 absolute right-4" />;
                                 } else if (i === selectedOption) {
                                     optClass = "bg-red-500/10 border-red-500/50 text-red-700 dark:text-red-400 opacity-60";
                                     OptIcon = <XCircle className="w-6 h-6 text-red-500/50 absolute right-4" />;
                                 } else {
                                     optClass = "border-amber-600/20 dark:border-amber-500/30 opacity-40 grayscale";
                                 }
                             } else if (i === selectedOption) {
                                 optClass = "ring-2 ring-yellow-500 bg-yellow-500/10 scale-[1.02] transition-transform font-bold";
                             }

                             return (
                                 <button 
                                    key={i}
                                    disabled={isAnswerRevealed}
                                    onClick={() => handleOptionClick(i)}
                                    className={cn("relative p-6 rounded-xl text-left transition-all duration-300 flex items-center md:text-lg", optClass, isAnswerRevealed ? "cursor-default" : "cursor-pointer")}
                                 >
                                    <span className="font-bold opacity-50 mr-4 font-mono">{String.fromCharCode(65 + i)}.</span>
                                    <div className="markdown-body pr-8"><ReactMarkdown>{opt}</ReactMarkdown></div>
                                    {OptIcon}
                                 </button>
                             );
                         })}
                     </div>
                     
                     {isAnswerRevealed && (
                         <div className="pt-8 border-t border-amber-600/20 dark:border-amber-500/30 animate-in fade-in slide-in-from-bottom-4 flex flex-col md:flex-row items-center justify-between gap-6">
                             <div className="flex-1 bg-stone-200/60 dark:bg-zinc-800/50 p-4 rounded-xl border border-amber-600/20 dark:border-amber-500/30">
                                 <span className="font-bold text-yellow-600 dark:text-yellow-400 flex items-center gap-2 mb-2">
                                     <Sparkles className="w-4 h-4" /> AI Giải Thích:
                                 </span>
                                 <p className="font-serif italic opacity-90">{currentQ?.explanation || "Đáp án đúng là " + String.fromCharCode(65 + getCorrectIndex(currentQ))}</p>
                             </div>
                             
                             <button onClick={handleNextQuestion} className="relative overflow-hidden group bg-yellow-500 hover:bg-yellow-600 text-black px-8 py-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg hover:shadow-[0_0_20px_rgba(245,158,11,0.5)] transition-all duration-500 transform hover:scale-105 hover:-translate-y-1 shrink-0 w-full md:w-auto before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/40 before:to-transparent before:-translate-x-full hover:before:translate-x-full before:transition-transform before:duration-700">
                                 {quizCurrentIndex + 1 < quizQuestions.length ? "Câu tiếp theo" : "Xem kết quả"}
                                 <ArrowRight className="w-5 h-5" />
                             </button>
                         </div>
                     )}
                 </div>
             )}
          </motion.div>
          </ErrorBoundary>
      )}
      </AnimatePresence>

      {activeTab === "mock_exam_setup" && (
          <ErrorBoundary fallback={<div className="p-8 bg-red-100/50 rounded-lg text-center dark:bg-red-900/10">Trình tạo bài thi phụ tạm thời không khả dụng.</div>}>
          <motion.div 
            key="mock-exam-setup-tab"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4 }}
            className="glass p-8 md:p-12 rounded-2xl max-w-4xl mx-auto space-y-8"
          >
              <div className="text-center space-y-4">
                  <BrainCircuit className="w-16 h-16 text-yellow-500 mx-auto" />
                  <h2 className="text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500">Tạo Mock Exam với AI</h2>
                  <p className="opacity-70 max-w-lg mx-auto italic font-serif">Chọn 1-3 bộ thẻ (Decks) để AI tự động cấu trúc bài kiểm tra đánh giá năng lực của bạn.</p>
              </div>

              <div className="space-y-4">
                  <h3 className="font-bold text-lg">1. Chọn bộ thẻ (Tối đa 3)</h3>
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {decks.map(deck => {
                          const isSelected = selectedExamDecks.includes(deck.id);
                          return (
                              <button 
                                key={deck.id}
                                onClick={() => {
                                    if (isSelected) {
                                        setSelectedExamDecks(prev => prev.filter(id => id !== deck.id));
                                    } else {
                                        if (selectedExamDecks.length < 3) {
                                            setSelectedExamDecks(prev => [...prev, deck.id]);
                                        }
                                    }
                                }}
                                className={cn("p-4 rounded-xl text-left border transition-all text-sm font-bold flex items-center justify-between", isSelected ? "border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" : "border-amber-600/20 dark:border-amber-500/30 opacity-60 hover:opacity-100 hover:border-yellow-500/50 bg-stone-200/60 dark:bg-zinc-800/50")}
                              >
                                  <span>{deck.title}</span>
                                  {isSelected && <CheckCircle2 className="w-4 h-4 text-yellow-500" />}
                              </button>
                          );
                      })}
                  </div>
              </div>

              <div className="space-y-4">
                  <h3 className="font-bold text-lg">2. Số lượng câu hỏi</h3>
                  <div className="flex gap-4">
                      {[5, 10, 15, 20].map(count => (
                          <button
                            key={count}
                            onClick={() => setExamQuestionCount(count)}
                            className={cn("px-6 py-2 rounded-xl font-bold border transition-all", examQuestionCount === count ? "border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" : "border-amber-600/20 dark:border-amber-500/30 opacity-60 hover:opacity-100 bg-stone-200/60 dark:bg-zinc-800/50")}
                          >
                              {count} câu
                          </button>
                      ))}
                  </div>
              </div>

              <div className="pt-8 flex justify-between items-center border-t border-amber-600/20 dark:border-amber-500/30">
                  <button onClick={() => setActiveTab("study")} className="font-bold opacity-60 hover:opacity-100 transition flex items-center gap-2">
                       <ArrowLeft className="w-4 h-4" /> Quay lại
                  </button>
                  <button 
                      onClick={generateMockExam}
                      disabled={selectedExamDecks.length === 0}
                      className="px-8 py-3 rounded-xl bg-yellow-500 text-black font-bold flex items-center gap-2 shadow-lg hover:bg-yellow-600 disabled:opacity-50 transition transform hover:scale-105"
                  >
                      <Sparkles className="w-5 h-5" />
                      Sinh Bài Thi (Mock Exam)
                  </button>
              </div>
          </motion.div>
          </ErrorBoundary>
      )}

      {activeTab === "skill_tree" && (
          <motion.div 
            key="skill-tree-tab"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4 }}
            className="space-y-8"
          >
              <div className="text-center space-y-4 mb-8">
                  <Network className="w-16 h-16 text-yellow-500 mx-auto" />
                  <h2 className="text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500">Cây Kỹ Năng & Lộ Trình</h2>
                  <p className="opacity-70 max-w-lg mx-auto italic font-serif">Khám phá vũ trụ kiến thức. Mở khóa và vươn tới sự thông tuệ đỉnh cao (Eudaimonia).</p>
              </div>

              <ErrorBoundary fallback={<div className="p-8 bg-red-100/50 rounded-lg text-center dark:bg-red-900/10">Bản đồ kỹ năng tạm thời không khả dụng.</div>}>
                  <SkillTreeGraph decks={decks} />
              </ErrorBoundary>
          </motion.div>
      )}

      {activeTab === "study" && (
        <motion.div 
          key="study-tab"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3 }}
          className="grid md:grid-cols-3 gap-8"
        >
          <section className="md:col-span-2 space-y-6">
            
            {/* DAILY QUEST BANNER */}
            <motion.div 
               initial={{ opacity: 0, y: -10 }}
               animate={{ opacity: 1, y: 0 }}
               className="relative overflow-hidden rounded-2xl p-6 md:p-8 bg-gradient-to-r from-blue-700 to-indigo-600 shadow-xl"
            >
               <div className="absolute top-0 right-0 p-4 opacity-20 pointer-events-none">
                  <Flame className="w-40 h-40" />
               </div>
               <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-2 text-white">
                     <h3 className="text-2xl font-display font-bold flex items-center gap-2">
                        <Flame className="w-6 h-6" /> Nhiệm vụ hôm nay (Daily Quest)
                     </h3>
                     <p className="opacity-90 max-w-md">
                        Lộ trình thông minh tự động trộn 20% thẻ mới và 80% thẻ ôn tập được gợi ý bằng thuật toán Spaced Repetition.
                     </p>
                  </div>
                  <button 
                     disabled={isStartingQuest}
                     onClick={handleStartDailyQuest}
                     className="shrink-0 bg-white text-indigo-700 hover:bg-stone-100 font-bold px-6 py-3 rounded-xl shadow-lg transition hover:scale-105 active:scale-95 text-center flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                     {isStartingQuest ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />} 
                     Bắt đầu Quests
                  </button>
               </div>
            </motion.div>

            {/* CO-STUDY ROOM BANNER CTA */}
            <motion.div 
               initial={{ opacity: 0, y: -10 }}
               animate={{ opacity: 1, y: 0 }}
               className="relative overflow-hidden rounded-2xl p-6 md:p-8 bg-gradient-to-r from-amber-600 to-yellow-500 shadow-xl"
            >
               <div className="absolute top-0 right-0 p-4 opacity-20 pointer-events-none">
                  <Users className="w-40 h-40" />
               </div>
               <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-2 text-white">
                     <h3 className="text-2xl font-display font-bold flex items-center gap-2">
                        <Users className="w-6 h-6" /> Phòng Tự Học Chung
                     </h3>
                     <p className="opacity-90 max-w-md">
                        Cùng tập trung Pomodoro với các bạn học khác trong không gian trực tuyến.
                     </p>
                  </div>
                  <Link 
                     to="/co-study"
                     className="shrink-0 bg-white text-amber-700 hover:bg-stone-100 font-bold px-6 py-3 rounded-xl shadow-lg transition hover:scale-105 active:scale-95 text-center flex items-center justify-center gap-2"
                  >
                     <Play className="w-5 h-5 fill-current" /> Tham Gia Ngay
                  </Link>
               </div>
            </motion.div>

            <div className="flex justify-between items-center flex-wrap gap-4">
              <h3 className="text-2xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 flex items-center gap-2">
                <BookOpen className="w-6 h-6 text-yellow-500" /> Your Studies
                {remindLaterCount > 0 && (
                  <span className="ml-2 text-xs font-bold text-white bg-blue-500 px-2.5 py-1 rounded-full animate-pulse shadow-md flex items-center gap-1.5">
                    <Bell className="w-3 h-3" />
                    {remindLaterCount} Thẻ nhắc nhở
                  </span>
                )}
              </h3>
              
              <button 
                onClick={toggleNotifications}
                className={cn("flex flex-1 md:flex-none justify-between items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition", notificationsEnabled ? "bg-stone-200/80 dark:bg-zinc-800/80 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30" : "bg-stone-200/40 dark:bg-zinc-800/40 opacity-70 hover:opacity-100 border border-transparent")}
              >
                <div className="flex items-center gap-2">
                  {notificationsEnabled ? <BellRing className="w-4 h-4 animate-pulse" /> : <BellOff className="w-4 h-4" />}
                  <span>{notificationsEnabled ? "Nhắc nhở đang bật" : "Nhắc nhở đang tắt"}</span>
                </div>
                {notificationsEnabled && pendingCardsCount > 0 && (
                  <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-bold shadow-md animate-in zoom-in-95">{pendingCardsCount} pending</span>
                )}
              </button>
            </div>

            {deckWithLowestMastery && (() => {
              const totalCards = deckWithLowestMastery.cards?.length || 0;
              const avgMastery = totalCards > 0 ? Math.round(
                deckWithLowestMastery.cards.reduce((sum: number, c: any) => sum + (c.mastery || 0), 0) / totalCards
              ) : 0;
              
              const weakCardsCount = deckWithLowestMastery.cards?.filter(
                (c: any) => (c.mastery || 0) < 50 || c.isHard
              ).length || 0;

              // Stoic quote adaptive advice
              let stoicAdvice = "The impediment to action advances action. What stands in the way becomes the way. - Marcus Aurelius";
              if (avgMastery < 30) {
                stoicAdvice = "Hãy can đảm đối diện với phần kiến thức thử thách nhất. Khó khăn chính là con đường tôi luyện trí tuệ vững vàng. - Marcus Aurelius";
              } else if (avgMastery < 60) {
                stoicAdvice = "Sự tiến bộ bền bỉ mỗi ngày vượt trội hơn sự bộc phát nhất thời. Một chút nỗ lực hôm nay sẽ định hình khả năng ngày mai. - Seneca";
              } else {
                stoicAdvice = "Bạn đã có nền tảng khá tốt ở bộ thẻ này. Hãy thực hiện bước chuyển hóa tiếp theo để đạt đến mức độ thông thạo tuyệt đối. - Epictetus";
              }

              return (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50/90 via-stone-100/40 to-stone-200/20 dark:from-zinc-900/60 dark:via-zinc-900/30 dark:to-zinc-950/20 border-2 border-amber-500/20 dark:border-amber-500/25 p-6 shadow-xl backdrop-blur-md mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6"
                >
                  {/* Subtle background glow */}
                  <div className="absolute -right-16 -top-16 w-32 h-32 bg-amber-500/10 blur-3xl rounded-full pointer-events-none" />
                  <div className="absolute -left-16 -bottom-16 w-32 h-32 bg-yellow-500/5 blur-3xl rounded-full pointer-events-none" />

                  <div className="space-y-4 flex-1">
                    {/* Header line with badge */}
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 bg-gradient-to-r from-amber-500/20 to-yellow-500/15 dark:from-amber-400/15 dark:to-yellow-400/5 text-amber-800 dark:text-amber-400 text-xs font-bold uppercase tracking-wider px-3.5 py-1 rounded-full shadow-sm border border-amber-500/20 animate-pulse">
                        <BrainCircuit className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                        Smart Study Suggestion
                      </span>
                      <span className="text-[11px] opacity-70 font-medium font-mono text-stone-600 dark:text-stone-400 bg-stone-300/40 dark:bg-zinc-800/40 px-2.5 py-0.5 rounded-md">
                        CẦN ÔN TẬP NHẤT LÚC NÀY
                      </span>
                    </div>

                    {/* Content body */}
                    <div className="space-y-2">
                      <h4 className="text-2xl font-display font-black text-stone-900 dark:text-stone-50 tracking-tight">
                        {deckWithLowestMastery.title}
                      </h4>
                      
                      {/* Stoic adaptive quote block */}
                      <p className="text-sm italic text-stone-600 dark:text-stone-400 font-serif border-l-2 border-amber-500/50 pl-3 py-0.5 opacity-90 max-w-2xl leading-relaxed">
                        "{stoicAdvice}"
                      </p>
                    </div>

                    {/* Info Metrics dashboard row */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2 border-t border-amber-500/10 dark:border-amber-500/15 max-w-xl">
                      {/* Metric 1 */}
                      <div className="space-y-0.5">
                        <span className="text-[10px] uppercase font-mono tracking-wider opacity-50">Mức thông thạo trung bình</span>
                        <div className="flex items-baseline gap-1">
                          <span className="text-xl font-bold font-mono text-yellow-600 dark:text-yellow-400">
                            {avgMastery}%
                          </span>
                          <span className="text-[10px] opacity-60">/ 100</span>
                        </div>
                      </div>

                      {/* Metric 2 */}
                      <div className="space-y-0.5">
                        <span className="text-[10px] uppercase font-mono tracking-wider opacity-50">Tổng số thẻ</span>
                        <div className="flex items-baseline gap-1">
                          <span className="text-xl font-bold font-mono text-stone-800 dark:text-stone-200">
                            {totalCards}
                          </span>
                          <span className="text-[10px] opacity-60">thẻ</span>
                        </div>
                      </div>

                      {/* Metric 3 */}
                      <div className="space-y-0.5 col-span-2 sm:col-span-1">
                        <span className="text-[10px] uppercase font-mono tracking-wider opacity-50">Thẻ yếu cần cải thiện</span>
                        <div className="flex items-baseline gap-1">
                          <span className="text-xl font-bold font-mono text-red-500 dark:text-red-400">
                            {weakCardsCount}
                          </span>
                          <span className="text-[10px] opacity-60">thẻ học</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* One-Click CTA Area */}
                  <div className="flex flex-col items-stretch sm:items-end justify-center shrink-0 w-full md:w-auto">
                    <Link
                      to={`/study/${deckWithLowestMastery.id}`}
                      className="group relative overflow-hidden bg-black dark:bg-white text-white dark:text-black font-extrabold py-4 px-8 rounded-xl transition-all duration-300 flex items-center justify-center gap-3 shadow-lg hover:shadow-amber-500/10 dark:hover:shadow-white/5 hover:scale-[1.03] active:scale-95 text-base shrink-0 border border-black/10 dark:border-white/10"
                    >
                      {/* Animated gradient strip */}
                      <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 opacity-0 group-hover:opacity-10 transition-opacity duration-300" />
                      
                      <Play className="w-5 h-5 fill-current ml-0.5 animate-pulse text-amber-500 dark:text-amber-500 group-hover:scale-110 transition-transform" />
                      <span>Học ngay 🚀</span>
                    </Link>
                  </div>
                </motion.div>
              );
            })()}

            <DeckList decks={decks.slice(0, 4)} showSearch={false} />

            <div className="mt-8 pt-8 border-t border-amber-600/20 dark:border-amber-500/30">
              <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <h3 className="text-2xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 flex items-center gap-2">
                  <Activity className="w-6 h-6 text-yellow-500" /> Weekly Mastery Trend
                </h3>
                <div className="flex items-center gap-2">
                  <select 
                    value={chartPeriod} 
                    onChange={(e) => setChartPeriod(e.target.value as any)}
                    className="bg-stone-200/60 dark:bg-zinc-800/50 border border-amber-600/20 dark:border-amber-500/30 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-yellow-500 appearance-none cursor-pointer"
                  >
                    <option value="7_days">Last 7 Days</option>
                    <option value="30_days">Last 30 Days</option>
                    <option value="all_time">All Time</option>
                  </select>
                  <button 
                    onClick={() => setIsChartExpanded(true)}
                    className="p-2 bg-stone-200/60 dark:bg-zinc-800/50 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium opacity-80 hover:opacity-100"
                    title="Phóng to biểu đồ"
                  >
                    <Maximize2 className="w-4 h-4" /> Phóng to
                  </button>
                </div>
              </div>
              
              <div className="grid md:grid-cols-2 gap-8">
                {/* Trend Chart */}
                <div className="glass p-6 rounded-xl w-full h-[300px] relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                      <XAxis 
                        dataKey="day" 
                        stroke="currentColor" 
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        opacity={0.7}
                      />
                      <YAxis 
                        stroke="currentColor"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        opacity={0.7}
                        width={40}
                      />
                      <Tooltip 
                        content={<CustomTooltip />}
                        cursor={{ stroke: 'rgba(234,179,8,0.2)', strokeWidth: 2 }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="points" 
                        stroke="#eab308" 
                        strokeWidth={3}
                        dot={{ fill: '#eab308', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, stroke: 'white', strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                
                {/* D3 Bubble Chart */}
                <div className="glass p-6 rounded-xl w-full h-[300px] relative flex flex-col">
                  <div className="mb-2 text-center text-sm font-bold opacity-70">
                    Phân Bố Mức Độ Thông Thạo (Kích thước = Số lượng thẻ)
                  </div>
                  <div className="flex-1 min-h-0 w-full relative">
                    {bubbleData.length > 0 ? (
                      <MasteryBubbleChart data={bubbleData} />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center opacity-60">Chưa có bài học</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Mastery Heatmap */}
              <div className="glass p-6 rounded-xl w-full mt-8 flex flex-col">
                 <h3 className="text-xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 mb-4 flex items-center gap-2">
                   <Target className="w-5 h-5 text-yellow-500" /> Mastery Heatmap (7 Ngày Qua)
                 </h3>
                 <div className="text-sm font-roman italic opacity-80 mb-6">
                   Theo dõi sự tiến bộ mức độ thông thạo của từng bộ thẻ qua thời gian. Màu càng sáng, độ thông thạo càng cao. 
                 </div>
                 <div className="w-full relative min-h-[280px]">
                    {heatmapData.length > 0 ? (
                      <MasteryHeatmap data={heatmapData} />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center opacity-60">Chưa có dữ liệu học tập</div>
                    )}
                 </div>
              </div>
            </div>
          </section>

          <aside className="space-y-8">
            <section className="glass p-6 rounded-xl">
              <h3 className="text-xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 mb-4 flex items-center gap-2">
                <Target className="w-5 h-5 text-blue-500" /> Mục tiêu Ngày
              </h3>
              <div className="flex flex-col items-center">
                 <div className="relative w-32 h-32 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                       <circle cx="50" cy="50" r="40" fill="transparent" stroke="currentColor" strokeWidth="8" className="opacity-10 text-blue-500" />
                       <circle 
                         cx="50" cy="50" r="40" 
                         fill="transparent" 
                         stroke="#3b82f6" 
                         strokeWidth="8" 
                         strokeDasharray={251.2} 
                         strokeDashoffset={251.2 - (Math.min(dailyReviewed / dailyGoal, 1) * 251.2)} 
                         strokeLinecap="round" 
                         className="transition-all duration-1000 ease-out"
                       />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                       <span className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400">{dailyReviewed}</span>
                       <span className="text-xs opacity-60">/ {dailyGoal} thẻ</span>
                    </div>
                 </div>
                 
                 <div className="mt-6 w-full space-y-2">
                    <label className="text-sm opacity-80 font-medium">Cài đặt mục tiêu (thẻ):</label>
                    <input 
                       type="number" 
                       min="1" max="1000"
                       value={dailyGoal}
                       onChange={handleDailyGoalChange}
                       className="w-full bg-black/5 dark:bg-white/5 border border-amber-600/20 dark:border-amber-500/30 rounded-lg px-3 py-2 text-stone-900 dark:text-stone-100 text-center font-bold focus:outline-none focus:border-blue-500 transition"
                    />
                 </div>
              </div>
            </section>

            <section className="glass p-6 rounded-xl">
              <h3 className="text-xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" /> Tổng kết Giờ Học (7 ngày)
              </h3>
              <div className="flex flex-col items-center justify-center p-4 bg-stone-200/60 dark:bg-zinc-800/50 rounded-xl border border-amber-600/20 dark:border-amber-500/30 shadow-inner">
                 <div className="text-4xl font-mono font-bold text-amber-600 dark:text-amber-400 mb-2 mt-2">
                    {studyHours}h {studyMinutes}m
                 </div>
                 <p className="text-xs opacity-70 text-center px-2">Dựa trên lịch sử ôn tập thẻ (tương đối)</p>
              </div>
            </section>

            <section className="glass p-6 rounded-xl">
              <h3 className="text-xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 mb-4 flex items-center gap-2">
                <MarcusAureliusIcon className="w-5 h-5 text-yellow-500" /> Leaderboard
              </h3>
              <div className="space-y-3">
                {sortedUsers.slice(0, 5).map((u, i) => (
                  <div key={u.id} className={cn("flex justify-between items-center p-2 rounded-lg", u.id === user?.id ? "bg-yellow-500/10 border border-yellow-500/20" : "")}>
                    <div className="flex items-center gap-3">
                      <span className={cn("font-bold font-mono text-sm", i === 0 ? "text-yellow-500" : "opacity-50")}>#{i + 1}</span>
                      <span className="font-medium truncate max-w-[120px]">{u.name}</span>
                    </div>
                    <span className="font-mono text-sm opacity-70 font-bold">{u.points} pts</span>
                  </div>
                ))}
              </div>
            </section>
            
          </aside>
        </motion.div>
      )}

      {activeTab === "all_sets" && (
        <motion.div
           key="all_sets-tab"
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           exit={{ opacity: 0, y: 20 }}
           transition={{ duration: 0.3 }}
           className="glass p-8 rounded-2xl max-w-4xl mx-auto space-y-6"
        >
           <h3 className="text-2xl font-display font-bold text-stone-800 dark:text-stone-100 flex items-center gap-2 mb-6">
              <BookOpen className="w-6 h-6 text-yellow-500" /> Tất cả bộ học
           </h3>
           <DeckList decks={decks} showSearch={true} />
        </motion.div>
      )}

      {activeTab === "groups" && (
        <motion.div 
          key="groups-tab"
        initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3 }}
          className="glass p-8 md:p-12 rounded-2xl relative overflow-hidden max-w-4xl mx-auto"
        >
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Users className="w-64 h-64" />
          </div>
          <div className="relative z-10 space-y-12">
            {activeGroup ? (
              <div className="space-y-8 animate-in zoom-in-95 duration-500">
                 <div className="text-center mb-10">
                   <h3 className="text-4xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 mb-2 flex justify-center items-center gap-3">
                      <Users className="w-8 h-8 text-blue-500" />
                      {activeGroup.name}
                   </h3>
                   <div className="flex items-center justify-center gap-4 mt-4">
                       <span className="font-mono bg-stone-200/60 dark:bg-zinc-800/50 border border-amber-600/20 dark:border-amber-500/30 text-lg font-bold py-2 px-6 rounded-lg select-all cursor-pointer" title="Copy to clipboard">
                           ID: {activeGroup.id}
                       </span>
                       <button onClick={handleLeaveGroup} className="text-red-500 hover:text-red-600 bg-red-500/10 px-4 py-2 rounded-lg font-bold transition hover:bg-red-500/20">
                          Rời Nhóm
                       </button>
                   </div>
                 </div>

                 <div className="bg-background/40 backdrop-blur border border-amber-600/20 dark:border-amber-500/30 p-8 rounded-2xl max-w-2xl mx-auto space-y-6 shadow-xl">
                    <div className="flex items-center gap-3 border-b border-amber-600/20 dark:border-amber-500/30 pb-4">
                       <MarcusAureliusIcon className="w-6 h-6 text-yellow-500" />
                       <h4 className="text-xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500">Xếp Hạng Thành Viên</h4>
                    </div>
                    
                    <ul className="space-y-4">
                       {activeGroup.members.map((member, i) => (
                          <li key={member.id} className={cn("flex items-center justify-between p-4 rounded-xl border transition-all", 
                             member.isCurrent ? "bg-yellow-500/10 border-yellow-500 text-yellow-900 dark:text-yellow-100 shadow-md transform scale-[1.02]" : "bg-stone-200/60 dark:bg-zinc-800/50 border-transparent")}
                          >
                             <div className="flex items-center gap-4">
                               <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-display font-bold text-lg shrink-0",
                                 i === 0 ? "bg-yellow-500 text-black shadow-lg shadow-yellow-500/20" : 
                                 i === 1 ? "bg-gray-300 text-black shadow-lg" : 
                                 i === 2 ? "bg-orange-400 text-black shadow-lg" : 
                                 "bg-stone-300/60 dark:bg-zinc-800/80"
                               )}>
                                 #{i + 1}
                               </div>
                               <div>
                                 <p className="font-bold flex items-center gap-2">
                                    {member.name}
                                    {member.isCurrent && <span className="bg-yellow-500 text-black text-xs px-2 py-0.5 rounded-full">(Bạn)</span>}
                                 </p>
                               </div>
                             </div>
                             <div className="font-mono font-bold text-lg opacity-80">
                               {member.points} pts
                             </div>
                          </li>
                       ))}
                    </ul>
                 </div>
              </div>
            ) : (
            <>
              <div className="text-center mb-10">
                <h3 className="text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 mb-2">Nhóm Học Tập</h3>
                <p className="opacity-70 font-serif italic text-lg max-w-xl mx-auto">Tham gia hoặc tạo nhóm để cùng nhau tiến bộ. Hành trình tri thức sẽ bớt gian nan hơn khi có bạn đồng hành.</p>
              </div>
              
              <div className="grid md:grid-cols-2 gap-12">
                  <section className="space-y-6">
                    <div className="flex items-center gap-3 border-b border-amber-600/20 dark:border-amber-500/30 pb-4">
                       <span className="bg-blue-500 text-white p-2 rounded-lg"><Users className="w-6 h-6" /></span>
                       <h3 className="text-2xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500">Tham gia nhóm</h3>
                    </div>
                    
                    <div className="space-y-4">
                      <label className="text-base font-bold opacity-80 block">Nhập ID nhóm của bạn:</label>
                      <div className="flex gap-2">
                        <input 
                           className="flex-1 bg-stone-200/60 dark:bg-zinc-800/50 border-2 border-amber-600/20 dark:border-amber-500/30 rounded-xl px-4 py-3 text-stone-900 dark:text-stone-100 text-lg focus:outline-none focus:border-blue-500 font-mono transition-colors"
                           placeholder="Ví dụ: A7B9F2" 
                           value={groupId}
                           onChange={e => setGroupId(e.target.value)}
                           onKeyDown={e => e.key === 'Enter' && handleJoinGroup()}
                        />
                      </div>
                      <motion.button 
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => { click(); handleJoinGroup(); }} 
                        className="bg-blue-600 text-white w-full py-3 rounded-xl text-lg font-bold hover:bg-blue-700 shadow-lg hover:shadow-blue-500/30 transition shadow-blue-500/10">
                          Tham Gia Ngay
                      </motion.button>
                    </div>
                  </section>
      
                  <section className="space-y-6">
                    <div className="flex items-center gap-3 border-b border-amber-600/20 dark:border-amber-500/30 pb-4">
                       <span className="bg-yellow-500 text-black p-2 rounded-lg"><MarcusAureliusIcon className="w-6 h-6" /></span>
                       <h3 className="text-2xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500">Tạo nhóm học tập</h3>
                    </div>
                    
                    <div className="space-y-4">
                      <label className="text-base font-bold opacity-80 block">Tên nhóm mới:</label>
                      <div className="flex gap-2">
                        <input 
                           className="flex-1 bg-stone-200/60 dark:bg-zinc-800/50 border-2 border-amber-600/20 dark:border-amber-500/30 rounded-xl px-4 py-3 text-stone-900 dark:text-stone-100 text-lg focus:outline-none focus:border-yellow-500 transition-colors"
                           placeholder="Nhóm vượt vũ môn..." 
                           value={newGroupName}
                           onChange={e => setNewGroupName(e.target.value)}
                           onKeyDown={e => e.key === 'Enter' && handleCreateGroup()}
                           disabled={isCreating}
                        />
                      </div>
                      <button onClick={handleCreateGroup} disabled={isCreating} className="relative overflow-hidden group bg-yellow-500 text-black w-full py-3 rounded-xl text-lg font-bold hover:bg-yellow-600 shadow-lg hover:shadow-[0_0_20px_rgba(245,158,11,0.5)] transition-all duration-500 transform hover:-translate-y-1 hover:scale-[1.02] disabled:opacity-50 disabled:transform-none before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/40 before:to-transparent before:-translate-x-full hover:before:translate-x-full before:transition-transform before:duration-700">
                        {isCreating ? (
                          <span className="flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Đang thiết lập...</span>
                        ) : "Khởi Tạo Nhóm"}
                      </button>
                    </div>
                  </section>
              </div>
            </>
            )}
          </div>
        </motion.div>
      )}

      {activeTab === "ranking" && (
        <motion.div 
          key="ranking-tab"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3 }}
          className="glass p-8 rounded-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <MarcusAureliusIcon className="w-64 h-64" />
          </div>
          <div className="relative z-10 max-w-2xl mx-auto space-y-6">
            <div className="text-center mb-10">
              <h3 className="text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 mb-2">Bảng Xếp Hạng Tuần</h3>
              <p className="opacity-70">Top học sinh có điểm tích lũy phong độ học tập cao nhất. Hệ thống tự động reset sau 7 ngày.</p>
            </div>
            
            <div className="space-y-4">
              {sortedUsers.map((u, i) => (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileHover={{ scale: 1.01 }}
                  key={u.id} className={cn("flex items-center justify-between p-4 rounded-xl border transition-all", 
                  u.id === user?.id ? "bg-yellow-500/10 border-yellow-500 text-yellow-900 dark:text-yellow-100 shadow-md scale-[1.02]" : "bg-stone-200/60 dark:bg-zinc-800/50 border-transparent hover:border-black/10 dark:hover:border-white/10"
                )}>
                  <div className="flex items-center gap-4">
                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-display font-bold text-lg shrink-0",
                      i === 0 ? "bg-yellow-500 text-black shadow-lg shadow-yellow-500/20" : 
                      i === 1 ? "bg-gray-300 text-black shadow-lg" : 
                      i === 2 ? "bg-orange-400 text-black shadow-lg" : 
                      "bg-stone-300/60 dark:bg-zinc-800/80"
                    )}>
                      {i + 1}
                    </div>
                    <div>
                      <p className="font-bold text-lg flex items-center flex-wrap gap-2">
                        {u.name} 
                        {u.id === user?.id && <span className="text-xs bg-yellow-500 text-black px-2 py-0.5 rounded-full uppercase tracking-wider">You</span>}
                      </p>
                      <p className="text-xs opacity-60">Học sinh</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="text-2xl font-bold">{u.points}</span>
                      <span className="opacity-60 text-sm">pts</span>
                    </div>
                    {(user?.role === "teacher" || user?.role === "admin") && u.id !== user?.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setStudentToDelete(u);
                        }}
                        className="p-1.5 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white rounded-lg transition"
                        title="Xóa học sinh"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
              
              {sortedUsers.length === 0 && (
                <div className="text-center p-8 opacity-50 font-bold border-2 border-dashed border-amber-600/20 dark:border-amber-500/30 rounded-xl">
                  Chưa có học sinh nào trên bảng xếp hạng tuần này.
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === "settings" && (
        <motion.div 
          key="settings-tab"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3 }}
          className="glass p-8 rounded-2xl relative overflow-hidden max-w-3xl mx-auto"
        >
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Settings className="w-48 h-48" />
          </div>
          
          <div className="relative z-10">
            <h3 className="text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 mb-8 flex items-center gap-3 border-b border-amber-600/20 dark:border-amber-500/30 pb-4">
               Cài Đặt Hệ Thống
            </h3>
            
            <div className="space-y-6">
              {/* Tùy Chọn Tắt m Toàn Cục */}
              <div className="card-3d p-6 rounded-xl flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
                 <div className="space-y-2 max-w-lg">
                    <h4 className="text-xl font-bold flex items-center gap-2">
                       {muteAll ? <VolumeX className="w-5 h-5 text-red-500" /> : <Volume2 className="w-5 h-5 text-yellow-500 animate-pulse" />}
                       Tắt Mọi Âm Thanh (Mute All)
                    </h4>
                    <p className="opacity-70 text-sm">
                      Tự động vô hiệu hóa toàn bộ hiệu ứng âm thanh (lật thẻ, âm chính xác, sai) trong các phòng học. Cài đặt này được sao lưu trên bộ nhớ cục bộ thiết bị của bạn.
                    </p>
                 </div>
                 <button 
                    onClick={() => {
                        const nextState = !muteAll;
                        setMuteAll(nextState);
                        setMutedStatus(nextState);
                    }}
                    className={cn(
                       "shrink-0 px-6 py-3 font-bold rounded-lg transition-all duration-300 transform hover:scale-105 flex items-center gap-2 shadow-lg cursor-pointer",
                       muteAll ? "bg-red-500 hover:bg-red-600 text-white" : "bg-yellow-500 hover:bg-yellow-600 text-black"
                    )}
                 >
                    {muteAll ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    {muteAll ? "Đang Tắt Tiếng" : "Bật Âm Thanh"}
                 </button>
              </div>

              <div className="card-3d p-6 rounded-xl flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
                 <div className="space-y-2 max-w-lg">
                    <h4 className="text-xl font-bold flex items-center gap-2"><Trash2 className="w-5 h-5 text-red-500" /> Xóa Dữ Liệu Cũ</h4>
                    <p className="opacity-70 text-sm">
                      Xóa bỏ các dữ liệu nháp của thẻ học (Agent 3) và danh sách thẻ yếu (weak_cards). Điều này giúp làm mới lộ trình học của bạn mà không ảnh hưởng đến điểm số hiện tại.
                    </p>
                 </div>
                 <button 
                    onClick={() => setShowClearConfirm(true)}
                    className="shrink-0 px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg transition-transform hover:scale-105 flex items-center gap-2 shadow-lg"
                 >
                    Xóa Dữ Liệu Ngay
                 </button>
              </div>
            </div>
          </div>

          {/* Dialog Confirmation */}
          <AnimatePresence>
             {showClearConfirm && (
                <motion.div 
                   initial={{ opacity: 0 }}
                   animate={{ opacity: 1 }}
                   exit={{ opacity: 0 }}
                   className="modal-glass-overlay flex items-center justify-center p-4"
                >
                   <motion.div 
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.95, opacity: 0 }}
                      className="bg-stone-100 dark:bg-zinc-900 border border-red-500/30 shadow-2xl rounded-2xl p-6 md:p-8 max-w-md w-full"
                   >
                      <div className="flex flex-col items-center text-center space-y-4">
                         <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mb-2">
                             <AlertTriangle className="w-8 h-8" />
                         </div>
                         <h3 className="text-2xl font-bold">Bạn có chắc chắn?</h3>
                         <p className="opacity-80 pb-4">
                            Hành động này sẽ xóa vĩnh viễn các dữ liệu nháp và danh sách thẻ yếu hiện tại (weak_cards) khỏi hệ thống. Bạn không thể hoàn tác thao tác này. Bạn có muốn tiếp tục không?
                         </p>
                         <div className="flex w-full gap-4">
                            <button 
                               onClick={() => setShowClearConfirm(false)}
                               className="flex-1 py-3 rounded-lg border border-amber-600/20 dark:border-amber-500/30 font-bold transition hover:bg-black/5 dark:hover:bg-white/5"
                            >
                               Hủy
                            </button>
                            <button 
                               onClick={handleClearOldData}
                               className="flex-1 py-3 rounded-lg bg-red-500 hover:bg-red-600 text-white font-bold transition-transform hover:scale-105 shadow-md"
                            >
                               Xác Nhận Xóa
                            </button>
                         </div>
                      </div>
                   </motion.div>
                </motion.div>
             )}
          </AnimatePresence>
        </motion.div>
      )}
      {activeTab === "history" && (
        <motion.div 
          key="history-tab"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3 }}
          className="glass p-6 md:p-8 rounded-2xl relative max-w-6xl mx-auto"
        >
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Activity className="w-48 h-48" />
          </div>
          <div className="relative z-10 space-y-8">
             <div className="flex justify-between items-center border-b border-amber-600/20 dark:border-amber-500/30 pb-4">
               <h3 className="text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500">
                  Lịch Sử & Phong Độ Ôn Tập
               </h3>
               {user && (
                 <div className="bg-orange-500/15 border border-orange-500/30 text-orange-700 dark:text-orange-400 px-4 py-1.5 rounded-full font-bold flex items-center gap-1.5 text-sm">
                   <Flame className="w-4 h-4 animate-bounce" />
                   Chuỗi học tập hiện tại: {user.streak || 0} ngày
                 </div>
               )}
             </div>

             <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
               {/* BAN TRÁI: BẢN ĐỒ HOẠT ĐỘNG / CALENDAR VIEW */}
               <div className="lg:col-span-5 space-y-6">
                 <div className="card-3d p-5 rounded-2xl">
                   <div className="flex justify-between items-center mb-4">
                     <button onClick={navigatePrevMonth} className="p-2 border border-amber-500/20 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition text-xs font-bold shrink-0 cursor-pointer">
                       Trước
                     </button>
                     <span className="font-display font-bold text-lg text-stone-800 dark:text-stone-200">
                       {calendarMonthLabel}
                     </span>
                     <button onClick={navigateNextMonth} className="p-2 border border-amber-500/20 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition text-xs font-bold shrink-0 cursor-pointer">
                       Sau
                     </button>
                   </div>

                   {/* Grid Weekdays */}
                   <div className="grid grid-cols-7 gap-1 text-center font-bold text-xs opacity-65 mb-2 py-1 text-stone-600 dark:text-stone-400">
                     {["CN", "T2", "T3", "T4", "T5", "T6", "T7"].map((w, idx) => (
                       <div key={idx} className={idx === 0 ? "text-red-500" : ""}>{w}</div>
                     ))}
                   </div>

                   {/* Grid Days */}
                   <div className="grid grid-cols-7 gap-1.5 text-center">
                     {/* Empty slot fillers */}
                     {Array.from({ length: firstDayOfMonth }).map((_, idx) => (
                       <div key={`empty-${idx}`} className="w-8 h-8 md:w-10 md:h-10"></div>
                     ))}

                     {/* Month days */}
                     {calendarDays.map((dayNum) => {
                       const dateKey = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                       const isActive = activeStudyDaysSet.has(dateKey);
                       const isToday = new Date().getDate() === dayNum && new Date().getMonth() === calendarMonth && new Date().getFullYear() === calendarYear;

                       return (
                         <div
                           key={dayNum}
                           className={cn(
                             "w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-sm transition relative select-none",
                             isActive
                               ? "bg-yellow-500 text-black font-extrabold shadow-[0_0_12px_rgba(234,179,8,0.5)] cursor-pointer"
                               : isToday
                               ? "border-2 border-yellow-500 text-yellow-600 dark:text-yellow-400 font-extrabold"
                               : "text-stone-700 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/5"
                           )}
                           title={isActive ? `Bạn có hoạt động ôn tập ngày ${dayNum}/${calendarMonth + 1}` : `Ngày ${dayNum}/${calendarMonth + 1}`}
                         >
                           {dayNum}
                           {isActive && (
                             <span className="absolute -bottom-0.5 w-1 h-1 bg-black dark:bg-black rounded-full"></span>
                           )}
                         </div>
                       );
                     })}
                   </div>

                   {/* Legend */}
                   <div className="mt-6 pt-4 border-t border-amber-600/10 dark:border-amber-500/15 flex justify-center items-center gap-6 text-xs text-stone-600 dark:text-stone-400">
                     <div className="flex items-center gap-1.5">
                       <span className="w-3.5 h-3.5 rounded-full bg-yellow-500 flex items-center justify-center text-[8px] text-black font-bold">✔</span>
                       <span>Đã học / Streak</span>
                     </div>
                     <div className="flex items-center gap-1.5">
                       <span className="w-3.5 h-3.5 rounded-full border-2 border-yellow-500"></span>
                       <span>Hôm nay</span>
                     </div>
                   </div>
                 </div>

                 {/* MOTIVATION CARD */}
                 <div className="bg-gradient-to-br from-amber-500/10 to-yellow-500/20 dark:from-yellow-500/5 dark:to-amber-500/10 border border-amber-500/20 rounded-2xl p-5 text-center shadow-sm">
                   <Sparkles className="w-6 h-6 text-yellow-500 mx-auto mb-3 animate-pulse" />
                   <h4 className="font-display font-bold text-stone-800 dark:text-stone-200 mb-1">Duy trì Ngọn lửa Tự học</h4>
                   <p className="text-xs text-stone-600 dark:text-stone-400 italic max-w-sm mx-auto leading-relaxed">
                     Lịch biểu này ghi chép chuỗi ngày năng nổ rèn luyện của bạn. Hãy hoàn thiện bài tập mỗi ngày để duy trì streak tăng hạng!
                   </p>
                 </div>
               </div>

               {/* BAN PHẢI: LỊCH SỬ CHI TIẾT */}
               <div className="lg:col-span-7 space-y-4">
                  <h4 className="text-lg font-bold text-stone-700 dark:text-stone-300 flex items-center gap-2 mb-2">
                    <Activity className="w-4.5 h-4.5 text-yellow-500" /> Bản ghi ôn tập chi tiết
                  </h4>
                  
                  <div className="space-y-4 max-h-[460px] overflow-y-auto pr-2">
                     {user && store.getReviewHistory(user.id).length > 0 ? (
                       store.getReviewHistory(user.id).map((record) => (
                         <motion.div 
                           key={record.id}
                           initial={{ opacity: 0, x: -20 }}
                           animate={{ opacity: 1, x: 0 }}
                           className="card-3d p-4 rounded-xl flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center"
                         >
                           <div className="space-y-1">
                             <div className="flex items-center gap-2">
                                <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-md bg-stone-200 dark:bg-zinc-700">{record.deckTitle}</span>
                                <span className="text-xs opacity-60 font-mono">{new Date(record.timestamp).toLocaleString()}</span>
                             </div>
                             <p className="font-bold text-sm md:text-base line-clamp-1">{record.front}</p>
                           </div>
                           <div className="flex items-center gap-4 shrink-0 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-black/5">
                              {record.remembered ? (
                                 <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-bold bg-green-500/10 px-3 py-1 rounded-full text-xs"><CheckCircle2 className="w-3.5 h-3.5"/> Nhớ mặt chữ</span>
                              ) : (
                                 <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-bold bg-red-500/10 px-3 py-1 rounded-full text-xs"><XCircle className="w-3.5 h-3.5"/> Chưa nhớ</span>
                              )}
                              <div className="font-mono text-sm w-16 text-right font-bold">
                                <span className={record.masteryChange >= 0 ? "text-green-500" : "text-red-500"}>
                                   {record.masteryChange > 0 ? "+" : ""}{record.masteryChange}%
                                 </span>
                              </div>
                           </div>
                         </motion.div>
                       ))
                     ) : (
                       <div className="text-center p-12 opacity-60 font-bold border-2 border-dashed border-amber-600/20 dark:border-amber-500/30 rounded-xl">
                          Chưa có lịch sử ôn tập. Hãy bắt đầu học!
                       </div>
                     )}
                  </div>
               </div>
             </div>
          </div>
        </motion.div>
      )}

      {/* Full-screen Expanded Chart Overlay */}
      <AnimatePresence>
      {isChartExpanded && (
        <motion.div 
          initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
          animate={{ opacity: 1, backdropFilter: "blur(4px)" }}
          exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
          className="modal-glass-overlay flex items-center justify-center p-4 md:p-8 z-[100]"
        >
          <motion.div 
            initial={{ scale: 0.95, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="bg-stone-100/80 dark:bg-zinc-950/40 shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-amber-600/20 dark:border-amber-500/30 rounded-2xl w-full h-full max-w-6xl max-h-[800px] flex flex-col p-6 md:p-8 relative backdrop-blur-xl"
          >
            <div className="flex justify-between items-center mb-6 border-b border-amber-600/20 dark:border-amber-500/30 pb-4 flex-wrap gap-4">
              <h3 className="text-2xl md:text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 flex items-center gap-3">
                <Activity className="w-8 h-8 text-yellow-500" /> Biểu Đồ Phong Độ Tuần
              </h3>
              <div className="flex items-center gap-4">
                <select 
                  value={chartPeriod} 
                  onChange={(e) => setChartPeriod(e.target.value as any)}
                  className="bg-stone-200/60 dark:bg-zinc-800/50 border border-amber-600/20 dark:border-amber-500/30 rounded-lg px-4 py-2 text-sm md:text-base font-medium focus:outline-none focus:ring-2 focus:ring-yellow-500 appearance-none cursor-pointer"
                >
                  <option value="7_days">Last 7 Days</option>
                  <option value="30_days">Last 30 Days</option>
                  <option value="all_time">All Time</option>
                </select>
                <button 
                  onClick={() => setIsChartExpanded(false)}
                  className="p-3 bg-stone-200/60 dark:bg-zinc-800/50 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition-colors text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  <Minimize2 className="w-6 h-6" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.2)" vertical={false} />
                  <XAxis 
                    dataKey="day" 
                    stroke="currentColor" 
                    fontSize={14}
                    tickLine={false}
                    axisLine={false}
                    opacity={0.7}
                    dy={10}
                  />
                  <YAxis 
                    stroke="currentColor"
                    fontSize={14}
                    tickLine={false}
                    axisLine={false}
                    opacity={0.7}
                    width={50}
                  />
                  <Tooltip 
                    content={<CustomTooltip />}
                    cursor={{ stroke: 'rgba(234,179,8,0.3)', strokeWidth: 2 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="points" 
                    stroke="#eab308" 
                    strokeWidth={4}
                    dot={{ fill: '#eab308', strokeWidth: 2, r: 6 }}
                    activeDot={{ r: 8, stroke: 'white', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </motion.div>
      )}

      {studentToDelete && (
        <div className="modal-glass-overlay flex items-center justify-center p-4">
          <div className="modal-glass-content p-6 max-w-md w-full">
            <h4 className="text-lg font-bold text-red-600 dark:text-red-400 flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5" /> Xác nhận xóa học sinh "{studentToDelete.name}"?
            </h4>
            <p className="text-sm opacity-85 mb-4">
              Bạn có quyền xóa hoặc khóa tài khoản học sinh này từ hệ thống Henosis.
            </p>
            
            <div className="mb-6 space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider opacity-60">Phương thức xử lý:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteMode("hard")}
                  className={cn(
                    "p-3 rounded-xl border text-xs font-bold transition flex flex-col gap-1 items-center text-center",
                    deleteMode === "hard"
                      ? "bg-red-500/10 border-red-500 text-red-600 dark:text-red-400"
                      : "border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-850"
                  )}
                >
                  <span>Xóa cứng (Hard)</span>
                  <span className="text-[10px] opacity-60 font-normal">Xóa sạch profile, nhóm và thẻ học</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteMode("soft")}
                  className={cn(
                    "p-3 rounded-xl border text-xs font-bold transition flex flex-col gap-1 items-center text-center",
                    deleteMode === "soft"
                      ? "bg-amber-500/10 border-amber-500 text-amber-600 dark:text-amber-400"
                      : "border-stone-200 dark:border-zinc-800 hover:bg-stone-50 dark:hover:bg-zinc-850"
                  )}
                >
                  <span>Xóa mềm (Soft)</span>
                  <span className="text-[10px] opacity-60 font-normal">Ẩn tài khoản hoạt động nhưng giữ lịch sử</span>
                </button>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setStudentToDelete(null)}
                disabled={isDeletingStudent}
                className="px-4 py-2 rounded-lg bg-stone-200 dark:bg-zinc-850 hover:bg-stone-300 dark:hover:bg-zinc-800 transition text-sm font-bold text-black dark:text-white"
              >
                Hủy bỏ
              </button>
              <button 
                onClick={handleDeleteStudentSubmit}
                disabled={isDeletingStudent}
                className={cn(
                  "px-4 py-2 rounded-lg text-white transition text-sm font-bold flex items-center gap-1.5",
                  deleteMode === "hard" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"
                )}
              >
                {isDeletingStudent ? "Đang xử lý..." : "Xác nhận thực hiện"}
              </button>
            </div>
          </div>
        </div>
      )}
      </AnimatePresence>
    </div>
  );
}
