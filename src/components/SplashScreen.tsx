import { useEffect, useState } from "react";

interface SplashScreenProps {
  onFinish: () => void;
}

export default function SplashScreen({ onFinish }: SplashScreenProps) {
  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("visible"), 80);
    const t2 = setTimeout(() => setPhase("exit"), 1600);
    const t3 = setTimeout(() => onFinish(), 2100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onFinish]);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center">
      {/* Ambient glow */}

      <div
        className={`flex flex-col items-center transition-all duration-500 ease-out ${
          phase === "enter"
            ? "opacity-0 scale-90"
            : phase === "exit"
              ? "opacity-0 scale-105"
              : "opacity-100 scale-100"
        }`}
      >
        <img
          src="/logoayvu.svg"
          alt="Ayvu"
          className="w-16 h-16 mb-5"
        />
        <h1 className="text-2xl font-heading font-semibold text-foreground tracking-tight">
          Ayvu
        </h1>
        <p className="text-sm text-muted mt-2">
          Build cascading AI agent workflows
        </p>
      </div>
    </div>
  );
}