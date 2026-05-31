import { useEffect, useState } from "react";

const MOBILE = 768;
const DESKTOP = 1024;

interface Breakpoint {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isNarrow: boolean; // <1024 — used to switch shell layout
}

const getBreakpoint = (): Breakpoint => {
  if (typeof window === "undefined") {
    return { isMobile: false, isTablet: false, isDesktop: true, isNarrow: false };
  }
  const w = window.innerWidth;
  return {
    isMobile:  w < MOBILE,
    isTablet:  w >= MOBILE && w < DESKTOP,
    isDesktop: w >= DESKTOP,
    isNarrow:  w < DESKTOP,
  };
};

export const useBreakpoint = (): Breakpoint => {
  const [bp, setBp] = useState<Breakpoint>(getBreakpoint);

  useEffect(() => {
    const handler = () => setBp(getBreakpoint());
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return bp;
};
