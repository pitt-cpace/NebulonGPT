import { useEffect, useRef, useState, useCallback } from "react";

type Opts = {
  containerRef: React.RefObject<HTMLElement>;
  endRef: React.RefObject<HTMLElement>;
  bottomThreshold?: number;   // px to consider "near bottom"
  smoothBehavior?: ScrollBehavior; // 'smooth' | 'auto'
  generating?: boolean; // NEW: only allow auto-scroll release during LLM generation
  chatId?: string | null; // Trigger re-initialization when chat changes
};

export function useStickyAutoScroll({
  containerRef,
  endRef,
  bottomThreshold = 64,
  smoothBehavior = "smooth",
  generating = false,
  chatId,
}: Opts) {
  const isPinnedRef = useRef(true); // auto-scroll allowed? - using ref to prevent re-renders
  const [isPinned, setIsPinned] = useState(true); // keep state for external consumers
  const [unread, setUnread] = useState(0);        // new messages while detached
  const [showJumpButton, setShowJumpButton] = useState(false); // show/hide jump button
  const isProgrammatic = useRef(false);
  const smoothGuardUntil = useRef(0);
  const SMOOTH_GUARD_MS = 650; // prevent ResizeObserver from interrupting smooth scrolls
  const BUTTON_HIDE_EPSILON = 4; // very small tolerance for "at bottom" for button visibility
  const isUserTyping = useRef(false); // Track if user is actively typing
  const generatingRef = useRef(generating); // Track generating state without triggering re-renders
  
  // Keep generatingRef in sync with generating prop
  useEffect(() => {
    generatingRef.current = generating;
  }, [generating]);

  const distanceFromBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return Infinity;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }, [containerRef]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = smoothBehavior) => {
      if (!endRef.current || !containerRef.current) return;
      
      if (behavior === 'smooth') {
        isProgrammatic.current = true;
        
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
        // For instant scrolling (auto), don't block subsequent scrolls
        // This allows rapid-fire auto-scrolling during streaming
        endRef.current.scrollIntoView({ behavior });
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
    
    // Initialize button state based on current scroll position
    const initializeButtonState = () => {
      const d = el.scrollHeight - el.scrollTop - el.clientHeight;
      const isAtBottomForButton = d <= BUTTON_HIDE_EPSILON;
      setShowJumpButton(!isAtBottomForButton);
    };
    
    // Call once on mount
    initializeButtonState();
    
    let lastTop = el.scrollTop;

    const onScroll = () => {
      if (isProgrammatic.current) {
        return;
      }
      
      const currentTop = el.scrollTop;
      const d = distanceFromBottom();
      const scrolledUp = currentTop < lastTop;
      
      // Use different thresholds for different purposes
      const isAtBottomForAutoScroll = d <= bottomThreshold; // 64px for auto-scroll
      const isAtBottomForButton = d <= BUTTON_HIDE_EPSILON; // 4px for button visibility
      
      // Easy release: any upward scroll immediately releases auto-scroll (ALWAYS, even during generation)
      const scrollUpDistance = lastTop - currentTop;
      if (scrolledUp && scrollUpDistance > 1) {
        isPinnedRef.current = false;
        setIsPinned(false);
        setShowJumpButton(true); // Show jump button when scrolling up
      } else if (isAtBottomForAutoScroll && !isUserTyping.current) {
        // At bottom for auto-scroll - enable auto-scroll ONLY if not typing
        isPinnedRef.current = true;
        setIsPinned(true);
        setUnread(0);
        
        // Only hide button if REALLY at bottom (4px tolerance)
        if (isAtBottomForButton) {
          setShowJumpButton(false);
        }
      }
      
      lastTop = currentTop;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [containerRef, endRef, distanceFromBottom, bottomThreshold, BUTTON_HIDE_EPSILON, chatId]);


  // 3) MutationObserver for content changes during streaming
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    
    const mo = new MutationObserver(() => {
      // During generation, ALWAYS auto-scroll
      if (generatingRef.current) {
        if (endRef.current) {
          endRef.current.scrollIntoView({ behavior: 'auto' });
        }
      } else if (isPinnedRef.current) {
        if (endRef.current) {
          endRef.current.scrollIntoView({ behavior: 'auto' });
        }
      }
    });
    
    // Observe all changes in the container
    mo.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    
    return () => mo.disconnect();
  }, [containerRef, endRef, chatId]);

  // 4) Follow layout shifts (tables/images loading) - for non-streaming changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // During generation, auto-scroll is handled by MutationObserver
      if (generatingRef.current) return;
      
      // Normal mode: check smooth guard and pinned state
      if (performance.now() < smoothGuardUntil.current) {
        return; // ⛔️ don't interrupt smooth scrolls
      }
      
      if (isPinnedRef.current) {
        scrollToBottom("auto");
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, scrollToBottom]);

  // Public API:
  return {
    isPinned,
    unread,
    showJumpButton,
    // Call when you append a new message
    onNewContent: () => {
      const el = containerRef.current;
      if (!el) return;
      
      const d = el.scrollHeight - el.scrollTop - el.clientHeight;
      const isAtBottomForButton = d <= BUTTON_HIDE_EPSILON;
      
      // Auto-scroll if: (pinned OR generating) AND not typing
      if ((isPinnedRef.current || generatingRef.current) && !isUserTyping.current) {
        scrollToBottom(); // Use smooth scrolling as originally intended
        setShowJumpButton(false);
        setUnread(0);
      } else {
        setShowJumpButton(true);
        setUnread(u => u + 1);
      }
    },
    jumpToLatest: (behavior: ScrollBehavior = "smooth") => {
      scrollToBottom(behavior); // allow customizable scroll behavior
      isPinnedRef.current = true;
      setIsPinned(true);
      setUnread(0);
      setShowJumpButton(false); // Hide jump button when clicking it
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
