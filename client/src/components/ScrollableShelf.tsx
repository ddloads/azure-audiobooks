import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

export default function ScrollableShelf({ children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const scroll = (dir: 1 | -1) => {
    ref.current?.scrollBy({ left: dir * 300, behavior: "smooth" });
  };

  return (
    <div className="shelf-scroll-wrap">
      {canLeft && (
        <button
          className="shelf-arrow shelf-arrow-left"
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      <div className="continue-shelf" ref={ref}>
        {children}
      </div>
      {canRight && (
        <button
          className="shelf-arrow shelf-arrow-right"
          onClick={() => scroll(1)}
          aria-label="Scroll right"
        >
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  );
}
