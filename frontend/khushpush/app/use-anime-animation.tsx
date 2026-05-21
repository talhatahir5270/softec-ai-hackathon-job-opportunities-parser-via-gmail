"use client";

import { useState, useEffect, useRef } from "react";
import { animate } from "animejs/animation";
import { stagger } from "animejs/utils";

export function useAnimeAnimation(
  options: {
    onview?: number;
    targets?: string;
    translateY?: [number, number];
    opacity?: [number, number];
    easing?: string;
    duration?: number;
    delay?: number | ((el: HTMLElement, i: number) => number);
  }
) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasAnimated, setHasAnimated] = useState(false);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);

  useEffect(() => {
    if (!ref.current || hasAnimated) return;

    const element = ref.current;
    const targets = options.targets && options.targets === ">*"
      ? Array.from(element.children)
      : [element];

    const animateTargets = () => {
      if (hasAnimated) return;

      if (element instanceof HTMLElement) {
        element.setAttribute("data-animated", "true");
      }

      // Set initial state for animation only if element is not already visible
      targets.forEach((target) => {
        if (target instanceof HTMLElement && target.style) {
          // Check if element is already visible - if so, skip hiding it
          const computed = window.getComputedStyle(target);
          const currentOpacity = parseFloat(computed.opacity);
          
          // Only hide if currently fully visible (opacity >= 1 or not set)
          if (currentOpacity >= 1 || isNaN(currentOpacity)) {
            target.style.opacity = String(options.opacity?.[0] || 0);
            target.style.transform = `translateY(${options.translateY?.[0] || 48}px)`;
          }
        }
      });

      // Animate with stagger - anime.js v4 API
      let delayValue: unknown;
      if (typeof options.delay === "function") {
        const firstTarget = targets[0] as HTMLElement;
        const secondTarget = (targets[1] || targets[0]) as HTMLElement;
        if (firstTarget && secondTarget) {
          const firstDelay = options.delay(firstTarget, 0);
          const secondDelay = options.delay(secondTarget, 1);
          const staggerAmount = secondDelay - firstDelay;
          delayValue = stagger(staggerAmount, { start: firstDelay });
        } else {
          delayValue = stagger(100, { start: 200 });
        }
      } else if (typeof options.delay === "number") {
        delayValue = options.delay;
      } else {
        delayValue = stagger(100, { start: 200 });
      }

      try {
        const animationOptions: Parameters<typeof animate>[1] = {
          translateY: options.translateY || [48, 0],
          opacity: options.opacity || [0, 1],
          easing: options.easing || "spring(1, 80, 10, 0)",
          duration: options.duration || 450,
          delay: delayValue as any,
        };
        
        const animation = animate(targets, animationOptions);
        animationRef.current = animation;
        setHasAnimated(true);
      } catch (error) {
        console.error("Animation error:", error);
        // Fallback: make content visible even if animation fails
        targets.forEach((target) => {
          if (target instanceof HTMLElement && target.style) {
            target.style.opacity = "1";
            target.style.transform = "translateY(0)";
          }
        });
        setHasAnimated(true);
      }
    };

    // Check if element is already in viewport
    const checkViewport = () => {
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const margin = Math.abs(options.onview || -100);
      return rect.top < viewportHeight + margin && rect.bottom > -margin;
    };

    // If already in view, animate immediately
    if (checkViewport()) {
      setTimeout(animateTargets, 100);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasAnimated) {
            animateTargets();
            observer.disconnect();
          }
        });
      },
      { threshold: 0.1, rootMargin: `${Math.abs(options.onview || -100)}px` }
    );

    observer.observe(element);
    
    // Fallback: if animation doesn't trigger after 1 second, make content visible
    const fallbackTimer = setTimeout(() => {
      if (!hasAnimated && ref.current) {
        targets.forEach((target) => {
          if (target instanceof HTMLElement && target.style) {
            target.style.opacity = "1";
            target.style.transform = "translateY(0)";
          }
        });
        setHasAnimated(true);
      }
    }, 1000);

    return () => {
      observer.disconnect();
      clearTimeout(fallbackTimer);
      if (animationRef.current) {
        if (typeof animationRef.current.pause === "function") {
          animationRef.current.pause();
        }
      }
    };
  }, [hasAnimated, options]);

  return ref;
}
