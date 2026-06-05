import React from 'react';
import { Award, Zap, Star, Shield, Cpu, Book, Flame, Calendar, Clock } from 'lucide-react';
import { cn } from '../lib/utils';

export const StudentBadges = ({ points, streak }: { points: number, streak: number }) => {
  const BADGES = [
    { id: 'novice', name: 'Novice Student', req: 50, icon: Book, color: 'text-stone-500', bg: 'bg-stone-500/20' },
    { id: 'early_bird', name: 'Early Bird', req: 200, icon: Zap, color: 'text-yellow-500', bg: 'bg-yellow-500/20' },
    { id: 'knowledge_seeker', name: 'Knowledge Seeker', req: 500, icon: Star, color: 'text-blue-500', bg: 'bg-blue-500/20' },
    { id: 'scholar', name: 'Dedicated Scholar', req: 1000, icon: Award, color: 'text-purple-500', bg: 'bg-purple-500/20' },
    { id: 'ai_master', name: 'AI Master', req: 2000, icon: Cpu, color: 'text-emerald-500', bg: 'bg-emerald-500/20' },
    { id: 'stoic', name: 'Stoic Sage', req: 5000, icon: Shield, color: 'text-orange-500', bg: 'bg-orange-500/20' },
    // Streaks
    { id: 'week_warrior', name: 'Week Warrior (7 ngày)', req: 7, icon: Flame, color: 'text-orange-600', bg: 'bg-orange-500/20', isStreak: true },
    { id: 'monthly_sage', name: 'Monthly Sage (30 ngày)', req: 30, icon: Calendar, color: 'text-amber-600', bg: 'bg-amber-500/20', isStreak: true },
    { id: 'century_master', name: 'Century Master (100 ngày)', req: 100, icon: Clock, color: 'text-red-600', bg: 'bg-red-500/20', isStreak: true },
  ];

  return (
    <div className="glass p-6 rounded-xl space-y-4">
      <h3 className="text-xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-700 via-amber-500 to-yellow-600 dark:from-amber-200 dark:via-yellow-400 dark:to-amber-500 flex items-center gap-2">
        <Award className="w-5 h-5 text-yellow-500" /> Thành Tựu ({points} pts | {streak} streak)
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 leading-tight">
        {BADGES.map(badge => {
          const val = badge.isStreak ? streak : points;
          const unlocked = val >= badge.req;
          const Icon = badge.icon;
          return (
              <div 
              key={badge.id}
              className={cn(
                "flex flex-col items-center p-3 rounded-xl border text-center transition-all duration-300 relative",
                unlocked 
                  ? `${badge.bg} border-${badge.color.replace('text-', '')}/30 shadow-sm hover:scale-105 ${badge.id === 'stoic' ? 'animate-pulse' : ''}` 
                  : "bg-black/5 dark:bg-white/5 border-transparent opacity-40 grayscale"
              )}
              title={unlocked ? 'Đã đạt được!' : `Yêu cầu: ${badge.req} ${badge.isStreak ? 'ngày liên tiếp' : 'điểm'}`}
            >
              <Icon className={cn("w-6 h-6 mb-2", unlocked ? badge.color : "text-stone-500")} />
              <span className="font-bold text-xs">{badge.name}</span>
              {unlocked && <span className="text-[10px] text-emerald-600 font-bold mt-1">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
