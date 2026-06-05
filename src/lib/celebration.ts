import confetti from 'canvas-confetti';

export const triggerCelebration = () => {
    confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#fde047', '#3b82f6', '#ef4444', '#22c55e']
    });
};
