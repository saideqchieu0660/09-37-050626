import React, { useState, useEffect } from "react";
import { Link, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { Moon, Sun, LogOut, MessageCircle, Flame, Volume2, VolumeX } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTheme, ThemeProvider } from "./components/ThemeProvider";
import { SoundProvider, useSoundContext } from "./components/SoundProvider";
import { MarcusAureliusIcon } from "./components/MarcusAureliusIcon";
import { StreakDisplay } from "./components/StreakDisplay";
import { Breadcrumbs } from "./components/Breadcrumbs";
import AuthScreen from "./components/AuthScreen";
import VerifyEmailScreen from "./components/VerifyEmailScreen";
import StudentDashboard from "./pages/StudentDashboard";
import TeacherDashboard from "./pages/TeacherDashboard";
import StudyRoom from "./pages/StudyRoom";
import CoStudyRoom from "./pages/CoStudyRoom";
import SetupProfileScreen from "./pages/SetupProfileScreen";
import AdminKeysDashboard from "./pages/AdminKeysDashboard";
import Agent3Widget from "./components/Agent3Widget";
import { GlobalErrorToast } from "./components/GlobalErrorToast";
import { auth } from "./lib/firebase";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { store } from "./lib/store";

import { ErrorBoundary } from "./components/ErrorBoundary";

const PageWrapper = ({ children }: { children: React.ReactNode }) => (
    <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
    >
        <ErrorBoundary>
            {children}
        </ErrorBoundary>
    </motion.div>
);

function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const { isSoundEnabled, toggleSound } = useSoundContext();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    let unsubscribe = () => {};
    try {
      console.log("Setting up auth state observer...");
      unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        try {
          if (currentUser && !currentUser.isAnonymous && !currentUser.emailVerified) {
            await signOut(auth);
            store.logout();
            setUser(null);
            setIsAuthLoading(false);
            const emailParams = currentUser.email ? `?email=${encodeURIComponent(currentUser.email)}` : "";
            navigate(`/verify${emailParams}`);
            return;
          }

          // Directly sync user with store
          await store.setFirebaseUser(currentUser);
          setUser(currentUser);
        } catch (e) {
          console.error("Firebase auth initialization error:", e);
          setUser(currentUser);
        } finally {
          setIsAuthLoading(false);
          // Redirect if not authenticated and not on verification page
          if (!currentUser && window.location.pathname !== '/verify') {
            navigate("/");
          }
        }
      });
    } catch (e) {
      console.error("Auth state observer error:", e);
      setIsAuthLoading(false);
    }

    return () => unsubscribe();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      if (auth.currentUser?.isAnonymous) {
          try {
             // In case they accidentally accrued a Firestore profile (maybe scored something), clear it to keep Leaderboard clean
             const { dbService } = await import("./lib/firebase");
             await dbService.deleteUserProfile(auth.currentUser.uid);
             await auth.currentUser.delete();
          } catch (delError) {
             console.error("Soft failing cleanup of anonymous auth:", delError);
          }
      } else {
          await signOut(auth);
      }
      store.logout();
      navigate("/");
    } catch (e) {
      console.error("Error signing out:", e);
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans transition-colors duration-300">
      <header className="bg-white/70 dark:bg-black/30 backdrop-blur-md border-b border-white/50 dark:border-white/10 shadow-sm fixed top-0 w-full z-40 px-4 md:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MarcusAureliusIcon className="w-6 h-6 text-yellow-500" />
          <span className="italic font-serif tracking-widest uppercase font-light text-xl md:text-2xl text-yellow-500">HENOSIS</span>
        </div>
        
        <div className="flex items-center gap-2 md:gap-4">
          {user && store.getCurrentUser()?.streak !== undefined && (
            <StreakDisplay />
          )}
          {user && (
            <a href="https://t.me/+O50q6ltXTzwxMzk1" target="_blank" rel="noopener noreferrer" 
               className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-500/20 dark:border-amber-500/40 bg-amber-500/10 hover:bg-yellow-500 hover:text-black transition text-stone-800 dark:text-stone-200 font-medium text-xs md:text-sm"
               title="Hỗ trợ (Telegram)">
              <MessageCircle className="w-4 h-4 text-yellow-500" />
              <span className="hidden sm:inline">Hỗ trợ Telegram</span>
              <span className="inline sm:hidden">Hỗ trợ</span>
            </a>
          )}

          <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition">
            {theme === "dark" ? <Sun className="w-5 h-5 text-yellow-500" /> : <Moon className="w-5 h-5" />}
          </button>

          <button onClick={toggleSound} className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition">
            {isSoundEnabled ? <Volume2 className="w-5 h-5 text-yellow-500" /> : <VolumeX className="w-5 h-5 text-stone-500" />}
          </button>
          
          {user && (
            <div className="flex items-center gap-2 md:gap-4">
              <span className="font-medium text-sm md:text-base hidden xs:inline">{user.email?.split("@")[0] || "User"}</span>
              <button onClick={handleLogout} className="p-2 rounded-full hover:bg-red-500/10 text-red-500 transition" title="Đăng xuất">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 mt-24 mb-10 px-4 md:px-8 max-w-7xl mx-auto w-full">
        <Breadcrumbs />
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {isAuthLoading ? (
              <div className="flex items-center justify-center p-20 mt-20">
                <div className="w-8 h-8 rounded-full border-4 border-amber-500 border-t-transparent animate-spin" />
              </div>
          ) : children}
        </motion.div>
      </main>

      {user && <Agent3Widget />}
      <GlobalErrorToast />
    </div>
  );
}

export default function App() {
  const location = useLocation();

  return (
    <ThemeProvider>
      <Layout>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<PageWrapper><AuthScreen /></PageWrapper>} />
            <Route path="/verify" element={<PageWrapper><VerifyEmailScreen /></PageWrapper>} />
            <Route path="/dashboard" element={<PageWrapper><StudentDashboard /></PageWrapper>} />
            <Route path="/teacher" element={<PageWrapper><TeacherDashboard /></PageWrapper>} />
            <Route path="/study/:deckId" element={<PageWrapper><StudyRoom /></PageWrapper>} />
            <Route path="/co-study" element={<PageWrapper><CoStudyRoom /></PageWrapper>} />
            <Route path="/setup-profile" element={<PageWrapper><SetupProfileScreen /></PageWrapper>} />
            <Route path="/admin/keys" element={<PageWrapper><AdminKeysDashboard /></PageWrapper>} />
          </Routes>
        </AnimatePresence>
      </Layout>
    </ThemeProvider>
  );
}
