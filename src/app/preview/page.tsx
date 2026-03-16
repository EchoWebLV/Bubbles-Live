"use client";

import { BubbleMapClient } from "@/components/bubble-map/BubbleMapClient";

export default function PreviewPage() {
  return (
    <main className="fixed inset-0 overflow-hidden" id="preview-root">
      <style jsx global>{`
        /* ── Preview mode: strip ALL UI, keep only the game canvas ── */

        /* The canvas sits at .absolute.inset-0 — keep it visible.
           Hide every other absolutely-positioned overlay (stats, buttons, modals). */
        #preview-root [class*="z-"]:not(canvas) {
          display: none !important;
        }

        /* Hide modals, backdrop overlays, fixed elements */
        #preview-root [role="dialog"],
        #preview-root [class*="backdrop"],
        #preview-root [class*="modal"] {
          display: none !important;
        }

        /* Hide any text/button that floats over the canvas */
        #preview-root button,
        #preview-root a,
        #preview-root [class*="rounded-xl"][class*="border"],
        #preview-root [class*="rounded-lg"][class*="border"] {
          display: none !important;
        }

        /* Make sure the canvas itself is always shown */
        #preview-root canvas {
          display: block !important;
          visibility: visible !important;
        }

        /* Kill all pointer events — pure visual only */
        #preview-root {
          pointer-events: none !important;
          cursor: default !important;
          user-select: none !important;
        }

        /* Suppress audio elements */
        #preview-root audio {
          display: none !important;
        }
      `}</style>
      <div className="relative w-full h-full">
        <BubbleMapClient />
      </div>
    </main>
  );
}
