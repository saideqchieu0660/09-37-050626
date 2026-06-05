import { v4 as uuidv4 } from "uuid";

export type Role = "student" | "teacher" | "admin";

export interface User {
  id: string;
  name: string;
  password?: string;
  role: Role;
  points: number; // For weekly ranking
  streak?: number;
  lastActiveDate?: string;
  streakFreeze?: boolean;
  isAnonymous?: boolean;
  status?: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  subject: string;
  mastery: number; // 0 to 100
  nextReview: number; // timestamp
  isHard: boolean; 
  interval?: number; // In days
  easeFactor?: number; // Default 2.5
  repetitionCount?: number; // Total consecutive successful reviews
  isNewCard?: boolean; // True if never reviewed yet
  nextReviewDate?: number; // Timestamp for next review
  originDeckId?: string;
  originDeckTitle?: string;
}

export interface ReviewRecord {
  id: string;
  userId: string;
  cardId: string;
  deckTitle: string;
  front: string;
  remembered: boolean;
  masteryChange: number;
  timestamp: number;
}

export interface Deck {
  id: string;
  title: string;
  subject: string;
  cards: Flashcard[];
}

export interface StudyGroup {
  id: string;
  name: string;
  members: string[]; // user ids
}

let users: User[] = [
  { id: "student_1", name: "Marcus", password: "123", role: "student", points: 42, streak: 5, lastActiveDate: new Date().toISOString().split('T')[0] },
  { id: "student_2", name: "Seneca", password: "123", role: "student", points: 28, streak: 2, lastActiveDate: new Date(Date.now() - 86400000).toISOString().split('T')[0] },
  { id: "student_3", name: "Epictetus", password: "123", role: "student", points: 89, streak: 12, lastActiveDate: new Date().toISOString().split('T')[0] },
  { id: "student_4", name: "Aurelius", password: "123", role: "student", points: 55, streak: 4, lastActiveDate: new Date().toISOString().split('T')[0] },
  { id: "student_5", name: "Zeno", password: "123", role: "student", points: 15, streak: 1, lastActiveDate: new Date().toISOString().split('T')[0] },
  { id: "student_6", name: "Cleanthes", password: "123", role: "student", points: 120, streak: 21, lastActiveDate: new Date().toISOString().split('T')[0] },
  { id: "student_7", name: "Chrysippus", password: "123", role: "student", points: 76, streak: 8, lastActiveDate: new Date().toISOString().split('T')[0] },
];

let currentUser: User | null = null;
let reviewHistory: ReviewRecord[] = [];

let decks: Deck[] = [
  {
    id: "deck_1",
    title: "Triết Học Khai Tâm",
    subject: "philosophy",
    cards: [
      { id: "card_1", front: "Amor Fati", back: "Yêu lấy định mệnh của mình.", subject: "philosophy", mastery: 95, nextReview: Date.now() + 86400000, isHard: false },
      { id: "card_2", front: "Memento Mori", back: "Hãy nhớ rằng bạn sẽ chết.", subject: "philosophy", mastery: 85, nextReview: Date.now() + 86400000, isHard: false },
    ]
  },
  {
    id: "deck_phil_2",
    title: "Triết Học Nâng Cao",
    subject: "philosophy",
    cards: [
      { id: "card_phil_1", front: "Eudaimonia", back: "Sự thăng hoa, hạnh phúc viên mãn.", subject: "philosophy", mastery: 20, nextReview: Date.now() - 50000, isHard: true },
      { id: "card_phil_2", front: "Prohairesis", back: "Năng lực lựa chọn.", subject: "philosophy", mastery: 10, nextReview: Date.now() - 50000, isHard: true },
    ]
  },
  {
    id: "deck_math_1",
    title: "Toán Dễ (Đại Số)",
    subject: "math",
    cards: [
      { id: "card_math_1", front: "Đạo hàm của x^2", back: "2x", subject: "math", mastery: 90, nextReview: Date.now() + 86400000, isHard: false },
      { id: "card_math_2", front: "Sin(30 độ)", back: "1/2", subject: "math", mastery: 100, nextReview: Date.now() + 86400000, isHard: false },
    ]
  },
  {
    id: "deck_math_2",
    title: "Toán Khó (Tích Phân)",
    subject: "math",
    cards: [
      { id: "card_math_3", front: "Nguyên hàm của cos(x)", back: "sin(x) + C", subject: "math", mastery: 0, nextReview: Date.now() - 10000, isHard: true },
    ]
  },
  {
    id: "deck_physics_1",
    title: "Vật Lý Cơ Bản",
    subject: "science",
    cards: [
      { id: "card_8", front: "Định luật 1 Newton", back: "Một vật đang đứng yên sẽ tiếp tục đứng yên...", subject: "science", mastery: 10, nextReview: Date.now() - 100000, isHard: true },
      { id: "card_9", front: "Công thức lực (Force)", back: "F = ma", subject: "science", mastery: 100, nextReview: Date.now() + 86400000*3, isHard: false },
    ]
  },
  {
    id: "deck_physics_2",
    title: "Vật Lý Lượng Tử",
    subject: "science",
    cards: [
      { id: "card_10", front: "Hằng số Planck", back: "6.626 x 10^-34 J.s", subject: "science", mastery: 0, nextReview: Date.now() - 100000, isHard: true },
    ]
  }
];

let groups: StudyGroup[] = [
  { id: "group_1", name: "Roman Scholars", members: ["student_1", "student_2", "student_4"] },
  { id: "group_2", name: "Physics Masters", members: ["student_3", "student_6", "student_7"] },
  { id: "group_3", name: "Stoic Circle", members: ["student_1", "student_3", "student_5", "student_7"] },
];

const checkAndResetWeeklyPoints = () => {
  const lastResetStr = localStorage.getItem("lastWeeklyReset");
  const now = Date.now();
  if (!lastResetStr) {
    localStorage.setItem("lastWeeklyReset", now.toString());
    return;
  }
  
  const lastReset = parseInt(lastResetStr, 10);
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  
  if (now - lastReset > SEVEN_DAYS) {
    // Reset points
    users.forEach(u => u.points = 0);
    if (currentUser) currentUser.points = 0;
    localStorage.setItem("lastWeeklyReset", now.toString());
    console.log("Weekly points have been reset to 0.");
  }
};

checkAndResetWeeklyPoints();

const updateStreak = (user: User) => {
  const today = new Date().toISOString().split('T')[0];
  if (user.lastActiveDate === today) {
    return;
  }
  if (user.lastActiveDate) {
    const lastActive = new Date(user.lastActiveDate);
    const current = new Date(today);
    const diffDays = Math.round(Math.abs(current.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      user.streak = (user.streak || 0) + 1;
    } else if (diffDays === 2 && user.streakFreeze) {
      user.streakFreeze = false;
      // Streak maintained, not reset, not increased
    } else if (diffDays > 1) {
      user.streak = 1;
    }
  } else {
    user.streak = 1;
  }
  user.lastActiveDate = today;
};

export async function syncUserToFirebase() {
  if (currentUser) {
    try {
      const { auth } = await import('./firebase');
      if (auth.currentUser?.isAnonymous && currentUser.points === 0) return; // Do not sync zero point anonymous users
      
      const { dbService } = await import('./firebase');
      await dbService.updateUserProfile(currentUser.id, {
        name: currentUser.name,
        role: currentUser.role,
        points: currentUser.points,
        streak: currentUser.streak || 1,
        lastActiveDate: currentUser.lastActiveDate || new Date().toISOString().split('T')[0],
        streakFreeze: !!currentUser.streakFreeze,
        isAnonymous: auth.currentUser?.isAnonymous || false
      });
    } catch (e) {
      console.error("Failed to sync currentUser to Firebase:", e);
    }
  }
}

export const store = {
  getUsers: () => users,
  getCurrentUser: () => {
    if (currentUser) updateStreak(currentUser);
    return currentUser;
  },
  setFirebaseUser: async (firebaseUser: any) => {
    if (!firebaseUser) {
        currentUser = null;
        return;
    }
    const email = firebaseUser.email || "User";
    const name = email.split('@')[0];
    let u = users.find(x => x.name === name);
    if (!u) {
       u = { id: firebaseUser.uid, name, role: "student", points: 0, streak: 1, lastActiveDate: new Date().toISOString().split('T')[0] };
       users.push(u);
    }
    currentUser = u;

    // Architecture 3: Trích xuất và Hydrate CardState cho user
    try {
        const { dbService, db, handleFirestoreError, OperationType } = await import('./firebase');
        const { collection, getDocs, setDoc, doc } = await import('firebase/firestore');

        // Lấy profile từ Firestore để đồng bộ role, points, streak, lastActiveDate, streakFreeze
        const profile = await dbService.getUserProfile(firebaseUser.uid);
        if (profile) {
            if (profile.role) u.role = profile.role;
            if (typeof profile.points === 'number') u.points = profile.points;
            if (typeof profile.streak === 'number') u.streak = profile.streak;
            if (profile.lastActiveDate) u.lastActiveDate = profile.lastActiveDate;
            if (typeof profile.streakFreeze === 'boolean') u.streakFreeze = profile.streakFreeze;
        } else {
            // Chưa có profile trên firestore, lưu quả profile mặc định đầu tiên lên (chỉ người dùng thật)
            if (!firebaseUser.isAnonymous) {
              await dbService.updateUserProfile(firebaseUser.uid, {
                 name: u.name,
                 role: u.role,
                 points: u.points,
                 streak: u.streak,
                 lastActiveDate: u.lastActiveDate,
                 streakFreeze: !!u.streakFreeze,
                 isAnonymous: false
              });
            }
        }

        // Chạy updateStreak lúc đăng nhập một cách an toàn và đồng bộ ngược lên db nếu đổi
        const oldStreak = u.streak;
        updateStreak(u);
        if (u.streak !== oldStreak) {
           if (!firebaseUser.isAnonymous) {
              await dbService.updateUserProfile(firebaseUser.uid, {
                 streak: u.streak,
                 lastActiveDate: u.lastActiveDate
              });
           }
        }

        // Hydrate Sets from Firestore
        try {
            const setsCol = collection(db, "sets");
            let setsSnapshot = await getDocs(setsCol);
            
            if (setsSnapshot.empty) {
                // Seed standard static decks into Firestore
                const defaultDecks = [
                  {
                    id: "deck_1",
                    title: "Triết Học Khai Tâm",
                    subject: "philosophy",
                    cards: [
                      { id: "card_1", front: "Amor Fati", back: "Yêu lấy định mệnh của mình.", subject: "philosophy", mastery: 95, nextReview: Date.now() + 86400000, isHard: false },
                      { id: "card_2", front: "Memento Mori", back: "Hãy nhớ rằng bạn sẽ chết.", subject: "philosophy", mastery: 85, nextReview: Date.now() + 86400000, isHard: false },
                    ]
                  },
                  {
                    id: "deck_phil_2",
                    title: "Triết Học Nâng Cao",
                    subject: "philosophy",
                    cards: [
                      { id: "card_phil_1", front: "Eudaimonia", back: "Sự thăng hoa, hạnh phúc viên mãn.", subject: "philosophy", mastery: 20, nextReview: Date.now() - 50000, isHard: true },
                      { id: "card_phil_2", front: "Prohairesis", back: "Năng lực lựa chọn.", subject: "philosophy", mastery: 10, nextReview: Date.now() - 50000, isHard: true },
                    ]
                  },
                  {
                    id: "deck_math_1",
                    title: "Toán Dễ (Đại Số)",
                    subject: "math",
                    cards: [
                      { id: "card_math_1", front: "Đạo hàm của x^2", back: "2x", subject: "math", mastery: 90, nextReview: Date.now() + 86400000, isHard: false },
                      { id: "card_math_2", front: "Sin(30 độ)", back: "1/2", subject: "math", mastery: 100, nextReview: Date.now() + 86400000, isHard: false },
                    ]
                  },
                  {
                    id: "deck_math_2",
                    title: "Toán Khó (Tích Phân)",
                    subject: "math",
                    cards: [
                      { id: "card_math_3", front: "Nguyên hàm của cos(x)", back: "sin(x) + C", subject: "math", mastery: 0, nextReview: Date.now() - 10000, isHard: true },
                    ]
                  },
                  {
                    id: "deck_physics_1",
                    title: "Vật Lý Cơ Bản",
                    subject: "science",
                    cards: [
                      { id: "card_8", front: "Định luật 1 Newton", back: "Một vật đang đứng yên sẽ tiếp tục đứng yên...", subject: "science", mastery: 10, nextReview: Date.now() - 100000, isHard: true },
                      { id: "card_9", front: "Công thức lực (Force)", back: "F = ma", subject: "science", mastery: 100, nextReview: Date.now() + 86400000*3, isHard: false },
                    ]
                  },
                  {
                    id: "deck_physics_2",
                    title: "Vật Lý Lượng Tử",
                    subject: "science",
                    cards: [
                      { id: "card_10", front: "Hằng số Planck", back: "6.626 x 10^-34 J.s", subject: "science", mastery: 0, nextReview: Date.now() - 100000, isHard: true },
                    ]
                  }
                ];

                for (const d of defaultDecks) {
                    await setDoc(doc(db, "sets", d.id), d);
                }
                setsSnapshot = await getDocs(setsCol);
            }

            const fbDecks: Deck[] = [];
            setsSnapshot.forEach(docSnap => {
                const deckData = docSnap.data();
                if (deckData && Array.isArray(deckData.cards)) {
                    deckData.cards = deckData.cards.map((c: any) => ({
                        ...c,
                        mastery: (typeof c.mastery === 'number' && !isNaN(c.mastery)) ? c.mastery : 0
                    }));
                }
                fbDecks.push(deckData as Deck);
            });
            if (fbDecks.length > 0) {
                decks = fbDecks;
            }
        } catch (setErr) {
            console.error("Failed to load sets from Firestore, fallback to static decks", setErr);
        }

        const states = await dbService.getAllCardStates(firebaseUser.uid);
        if (states && states.length > 0) {
            const stateMap = new Map();
            states.forEach((s: any) => stateMap.set(s.id, s));
            
            // Loop through default local decks and update flashcards memory
            decks.forEach(deck => {
                deck.cards.forEach(card => {
                    const savedState = stateMap.get(card.id);
                    if (savedState) {
                        card.mastery = typeof savedState.mastery === 'number' && !isNaN(savedState.mastery) ? savedState.mastery : (Number(card.mastery) || 0);
                        card.nextReviewDate = typeof savedState.nextReviewDate === 'number' ? savedState.nextReviewDate : (typeof savedState.nextReview === 'number' ? savedState.nextReview : card.nextReviewDate);
                        card.nextReview = card.nextReviewDate || card.nextReview; // Legacy sync
                        card.interval = typeof savedState.interval === 'number' ? savedState.interval : card.interval;
                        card.repetitionCount = typeof savedState.repetitionCount === 'number' ? savedState.repetitionCount : (typeof savedState.repetition === 'number' ? savedState.repetition : card.repetitionCount);
                        card.easeFactor = typeof savedState.easeFactor === 'number' ? savedState.easeFactor : (typeof savedState.efactor === 'number' ? savedState.efactor : card.easeFactor);
                        card.isNewCard = typeof savedState.isNewCard === 'boolean' ? savedState.isNewCard : false; // If it's saved in state it's no longer new
                        card.isHard = typeof savedState.isWeakCard !== 'undefined' ? savedState.isWeakCard : card.isHard;
                    }
                });
            });
        }
    } catch (e) {
        console.error("Failed to hydrate cards state from Firebase:", e);
    }
  },
  logout: () => { currentUser = null; },
  updateCurrentUser: (updates: Partial<User>) => {
    if (currentUser) {
      currentUser = { ...currentUser, ...updates };
      const idx = users.findIndex(u => u.id === currentUser?.id);
      if (idx >= 0) {
        users[idx] = { ...users[idx], ...updates };
      }
    }
  },
  signup: (name: string, password: string, adminKey?: string) => {
    if (users.find(x => x.name === name)) return null; // already exists
    
    let role: Role = "student";
    const correctAdminKey = (import.meta as any).env?.VITE_ADMIN_KEY || "seneca";
    if (adminKey && adminKey === correctAdminKey) {
       role = "teacher";
    }

    const u: User = { id: `user_${uuidv4()}`, name, password, role, points: 0, streak: 1, lastActiveDate: new Date().toISOString().split('T')[0] };
    users.push(u);
    currentUser = u;
    return u;
  },
  login: (name: string, password?: string, adminKey?: string) => {
    let u = users.find(x => x.name === name);
    
    if (u && password && u.password !== password) {
      return null; // invalid password
    }

    if (u) {
       // if they provided correct admin key, upgrade them
       const correctAdminKey = (import.meta as any).env?.VITE_ADMIN_KEY || "seneca";
       if (adminKey && adminKey === correctAdminKey) {
          u.role = "teacher";
       }
       currentUser = u;
    }
    
    return u;
  },
  getDecks: () => decks,
  setTempDeck: (deck: any) => {
    decks = decks.filter(d => d.id !== deck.id);
    decks.push(deck);
  },
  getDeck: (id: string) => decks.find(d => d.id === id),
  addDeck: async (deck: Deck) => {
    decks.push(deck);
    try {
      const { db } = await import("./firebase");
      const { doc, setDoc } = await import("firebase/firestore");
      await setDoc(doc(db, "sets", deck.id), {
        id: deck.id,
        title: deck.title,
        subject: deck.subject,
        cards: deck.cards
      });
    } catch (e) {
      console.error("Failed to add deck/set to Firestore:", e);
    }
  },
  deleteDeckLocally: (deckId: string) => {
    decks = decks.filter(d => d.id !== deckId);
  },
  setDecksLocally: (newDecks: Deck[]) => {
    decks = newDecks;
  },
  addCardLocally: (deckId: string, card: Flashcard) => {
    const deck = decks.find(d => d.id === deckId);
    if (deck) {
      if (!deck.cards.some(c => c.id === card.id)) {
        deck.cards.push(card);
      }
    }
  },
  removeCardLocally: (deckId: string, cardId: string) => {
    const deck = decks.find(d => d.id === deckId);
    if (deck) {
      deck.cards = deck.cards.filter(c => c.id !== cardId);
    }
  },
  buyStreakFreeze: () => {
    if (currentUser && currentUser.points >= 50 && !currentUser.streakFreeze) {
      currentUser.points -= 50;
      currentUser.streakFreeze = true;
      syncUserToFirebase();
      return true;
    }
    return false;
  },
  addBonusPoints: (points: number) => {
    if (currentUser && currentUser.role === "student") {
        currentUser.points += points;
        syncUserToFirebase();
    }
  },
  updateCardMastery: (deckId: string, cardId: string, remembered: boolean) => {
     const deck = decks.find(d => d.id === deckId);
     if (!deck) return;
     const card = deck.cards.find(c => c.id === cardId);
     if (!card) return;

     const oldMastery = card.mastery;

     // SuperMemo-2 Spaced Repetition Logic
     let quality = remembered ? 4 : 1; 
     let rep = card.repetitionCount || 0;
     let ef = card.easeFactor || 2.5;
     let inter = card.interval || 0;

     if (remembered) {
         if (rep === 0) {
             inter = 1;
         } else if (rep === 1) {
             inter = 6;
         } else {
             inter = Math.round(inter * ef);
         }
         rep += 1;
         
         card.mastery = Math.min(100, card.mastery + 20);
         card.isHard = false;
         if (currentUser && currentUser.role === "student") {
             currentUser.points += 1;
         }
     } else {
         rep = 0;
         inter = 1;
         card.mastery = Math.max(0, card.mastery - 20);
         card.isHard = true;
     }

     ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
     if (ef < 1.3) ef = 1.3;

     card.repetitionCount = rep;
     card.easeFactor = ef;
     card.interval = inter;
     card.isNewCard = false;
     card.nextReviewDate = Date.now() + (inter * 86400000); // interval to milliseconds

     const masteryChange = card.mastery - oldMastery;

     if (currentUser && currentUser.id) {
         // Sync to Firestore Architecture 3. users/{uid}/cardsState/{cardId}
         import('./firebase').then(({ dbService }) => {
            dbService.setCardState(currentUser.id, card.id, {
                mastery: card.mastery,
                nextReviewDate: card.nextReviewDate, // updated
                nextReview: card.nextReviewDate, // legacy support fallback
                interval: card.interval,
                repetitionCount: card.repetitionCount,
                easeFactor: card.easeFactor,
                isNewCard: card.isNewCard,
                isWeakCard: card.isHard
            }).catch(e => console.error("Firebase sync error:", e));
         });
         
         if (currentUser.role === "student") {
             const today = new Date().toISOString().split('T')[0];
             const key = `daily_reviewed_${currentUser.id}_${today}`;
             const currentReviewed = parseInt(localStorage.getItem(key) || "0", 10);
             localStorage.setItem(key, (currentReviewed + 1).toString()); syncUserToFirebase();

             reviewHistory.push({
               id: uuidv4(),
               userId: currentUser.id,
               cardId: card.id,
               deckTitle: deck.title,
               front: card.front,
               remembered,
               masteryChange,
               timestamp: Date.now()
             });
         }
     }
  },
  getReviewHistory: (userId: string) => {
     return reviewHistory.filter(r => r.userId === userId).sort((a, b) => b.timestamp - a.timestamp);
  },
  getGroups: () => groups,
  updateCard: (deckId: string, cardId: string, front: string, back: string) => {
     const deck = decks.find(d => d.id === deckId);
     if (!deck) return;
     const card = deck.cards.find(c => c.id === cardId);
     if (!card) return;
     card.front = front;
     card.back = back;
  },
  removeDeckLocally: (deckId: string) => {
     decks = decks.filter(d => d.id !== deckId);
  },
  createGroup: (name: string) => {
    let g = { id: `grp_${uuidv4().substring(0, 8)}`, name, members: currentUser ? [currentUser.id] : [] };
    groups.push(g);
    return g;
  },
  joinGroup: (id: string) => {
    let g = groups.find(x => x.id === id);
    if (g && currentUser && !g.members.includes(currentUser.id)) {
      g.members.push(currentUser.id);
    }
    return g;
  }
};
