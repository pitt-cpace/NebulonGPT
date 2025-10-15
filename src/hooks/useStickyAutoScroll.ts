import { useEffect, useRef, useState, useCallback } from "react";

type Opts = {
  containerRef: React.RefObject<HTMLElement>;
  endRef: React.RefObject<HTMLElement>;
  bottomThreshold?: number;   // px to consider "near bottom"
  smoothBehavior?: ScrollBehavior; // 'smooth' | 'auto'
  generating?: boolean; // NEW: only allow auto-scroll release during LLM generation
};

export function useStickyAutoScroll({
  containerRef,
  endRef,
  bottomThreshold = 64,
  smoothBehavior = "smooth",
  generating = false,
}: Opts) {
  const isPinnedRef = useRef(true); // auto-scroll allowed? - using ref to prevent re-renders
  const [isPinned, setIsPinned] = useState(true); // keep state for external consumers
  const [unread, setUnread] = useState(0);        // new messages while detached
  const isProgrammatic = useRef(false);
  const smoothGuardUntil = useRef(0);
  const SMOOTH_GUARD_MS = 650; // prevent ResizeObserver from interrupting smooth scrolls
  const isUserTyping = useRef(false); // Track if user is actively typing

  const distanceFromBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return Infinity;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }, [containerRef]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = smoothBehavior) => {
      if (!endRef.current || !containerRef.current) return;
      
      isProgrammatic.current = true;
      
      if (behavior === 'smooth') {
        // Set smooth guard to prevent ResizeObserver interruption
        smoothGuardUntil.current = performance.now() + SMOOTH_GUARD_MS;
        
        const container = containerRef.current;
        const targetScrollTop = container.scrollHeight - container.clientHeight;
        
        container.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth'
        });
        
        // Wait for animation to complete before allowing other operations
        setTimeout(() => { isProgrammatic.current = false; }, SMOOTH_GUARD_MS + 50);
      } else {
        // Use scrollIntoView for instant scrolling
        endRef.current.scrollIntoView({ behavior });
        requestAnimationFrame(() => { isProgrammatic.current = false; });
      }
    },
    [endRef, containerRef, smoothBehavior, SMOOTH_GUARD_MS]
  );

  // Simple scroll listener - easy release with small upward scroll (ONLY METHOD)
  useEffect(() => {
    // Wait for both refs to be available
    const el = containerRef.current;
    const endEl = endRef.current;
    

    
    if (!el || !endEl) {
      return;
    }
    
    let lastTop = el.scrollTop;

    const onScroll = () => {
      if (isProgrammatic.current) {
        return;
      }
      
      const currentTop = el.scrollTop;
      const d = distanceFromBottom();
      const scrolledUp = currentTop < lastTop;
      
      // Easy release: any upward scroll immediately releases auto-scroll (ALWAYS)
      const scrollUpDistance = lastTop - currentTop;
      if (scrolledUp && scrollUpDistance > 1) {
        isPinnedRef.current = false;
        setIsPinned(false); // Update state so button appears
      } else if (d <= bottomThreshold && !isUserTyping.current) { // At bottom - enable auto-scroll ONLY if not typing
        if (!isPinnedRef.current) {
          if (generating) {
            isPinnedRef.current = true;
            setIsPinned(true); // Update state to hide button
            setUnread(0);
          } else {
            // User scrolled to bottom manually - update state to hide button
            setIsPinned(true);
          }
        }
      }
      
      lastTop = currentTop;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [containerRef, endRef, distanceFromBottom, generating]);


  // 3) Follow layout shifts (tables/images loading) only if pinned
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (performance.now() < smoothGuardUntil.current) return; // ⛔️ don't interrupt smooth scrolls
      if (isPinnedRef.current) scrollToBottom("auto"); // don't animate for small layout shifts
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, scrollToBottom]);

  // Public API:
  return {
    isPinned,
    unread,
    // Call when you append a new message
    onNewContent: () => {
      if (isPinnedRef.current && !isUserTyping.current) {
        scrollToBottom(); // Use smooth scrolling as originally intended
      } else {
        setUnread(u => u + 1);
      }
    },
    jumpToLatest: (behavior: ScrollBehavior = "smooth") => {
      scrollToBottom(behavior); // allow customizable scroll behavior
      isPinnedRef.current = true;
      setIsPinned(true);
      setUnread(0);
    },
    setUserTyping: (typing: boolean) => {
      isUserTyping.current = typing;
      if (typing) {
        // When user starts typing, disable auto-scroll
        isPinnedRef.current = false;
      }
    },
  };
}
