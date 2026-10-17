// Motion primitives adapted from components published on 21st.dev: NumberTicker, BorderBeam and AnimatedList
// (Magic UI, MIT) and TextShimmer (motion-primitives, MIT). Tailwind classes became tokens in app.css; numbers are
// pt-BR and exact strings stay the source of truth (the animation only interpolates what is already formatted).
import { AnimatePresence, motion, useInView, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react';
import type { Status } from '../api/agent';

/** Counts up to `value` when it enters the view, then springs between later values. */
export function NumberTicker({ value, format, className = '', delay = 0 }: {
  value: number; format: (value: number) => string; className?: string; delay?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(reduce ? value : 0);
  const spring = useSpring(motionValue, { damping: 60, stiffness: 140 });
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    const timer = setTimeout(() => motionValue.set(value), delay * 1000);
    return () => clearTimeout(timer);
  }, [inView, value, delay, motionValue]);

  useEffect(() => spring.on('change', latest => {
    // Snap to the exact formatted value at rest so cents never drift from the server figure.
    if (ref.current) ref.current.textContent = format(Math.abs(latest - value) < 0.005 ? value : latest);
  }), [spring, format, value]);

  return <span ref={ref} className={`num ${className}`} aria-label={format(value)}>{format(reduce ? value : 0)}</span>;
}

/** Text with a light sweep, for what the agent is doing right now. */
export function TextShimmer({ children, as: Component = 'span', className = '', duration = 2 }: {
  children: string; as?: ElementType; className?: string; duration?: number;
}) {
  return (
    <Component className={`text-shimmer ${className}`} style={{ '--shimmer-spread': `${children.length * 2}px`, '--shimmer-duration': `${duration}s` } as CSSProperties}>
      {children}
    </Component>
  );
}

/** A light travelling around the border of the nearest positioned ancestor. */
export function BorderBeam({ size = 90, duration = 7, colorFrom = 'var(--accent)', colorTo = 'var(--series-1)' }: {
  size?: number; duration?: number; colorFrom?: string; colorTo?: string;
}) {
  return (
    <span className="border-beam" aria-hidden>
      <span style={{ width: size, offsetPath: `rect(0 auto auto 0 round ${size}px)`, '--beam-from': colorFrom, '--beam-to': colorTo, '--beam-duration': `${duration}s` } as CSSProperties} />
    </span>
  );
}

/** Children enter with a spring and leave smoothly; keys must be stable. */
export function AnimatedList({ children, className = '' }: { children: ReactNode[]; className?: string }) {
  return (
    <div className={className}>
      <AnimatePresence initial={false}>
        {children.map((child, index) => (
          <motion.div key={(child as { key?: string }).key ?? index} layout initial={{ scale: .96, opacity: 0, y: -6 }} animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: .96 }} transition={{ type: 'spring', stiffness: 350, damping: 34 }}>
            {child}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export type AgentMood = 'working' | 'waiting' | 'done' | 'failed' | 'idle';

export function moodOf(status: Status | 'queued' | undefined): AgentMood {
  if (status === 'running' || status === 'pending' || status === 'queued') return 'working';
  if (status === 'awaiting_approval') return 'waiting';
  if (status === 'failed' || status === 'rejected') return 'failed';
  if (status === 'done' || status === 'approved' || status === 'exceptions') return 'done';
  return 'idle';
}

/** The agent's presence: breathes while working, holds while it waits for a human. */
export function AgentOrb({ mood, size = 44 }: { mood: AgentMood; size?: number }) {
  const label = { working: 'Agente trabalhando', waiting: 'Agente aguardando você', done: 'Agente concluiu', failed: 'Agente parou', idle: 'Agente em espera' }[mood];
  return (
    <span className={`agent-orb ${mood}`} style={{ width: size, height: size }} role="img" aria-label={label}>
      <span className="agent-orb-core" />
      {mood === 'working' && <span className="agent-orb-ring" />}
    </span>
  );
}
