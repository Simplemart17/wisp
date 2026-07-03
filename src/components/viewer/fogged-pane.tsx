"use client";

/**
 * The sealed pane: ciphertext-like glyphs held behind fog. The gate shows it
 * locked; the working state shows it while decryption runs — one continuous
 * material from sealed to revealed.
 */
export function FoggedPane({
  thinOnIntent = false,
  children,
}: {
  /** Let the fog thin slightly while the unlock button is hovered. */
  thinOnIntent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="elevate relative overflow-hidden rounded-md border border-mist bg-card px-6 py-9">
      {/* The well stays crisp; only the ciphertext inside it is fogged. */}
      <div aria-hidden className="well -mx-3 overflow-hidden rounded-sm px-4 py-4">
        <div
          className={`select-none space-y-2.5 font-mono text-sm blur-[7px] ${
            thinOnIntent
              ? "transition-[filter] duration-500 group-has-[button[type=submit]:hover]:blur-xs"
              : ""
          }`}
        >
          <p className="text-ink/45">a7F2 kQ9x ██ 3mZ ██████ p8 ██ Ld0 ██ vY</p>
          <p className="text-ink/40">██ 6Rb ████ tW1 ██ jN ██████ 4Hq ██ zC</p>
          <p className="text-ink/45">Gk9 ██ 2Vs ██████ eP ██ 7xM ████ Ao ██</p>
          <p className="text-ink/35">██████ dL5 ██ 8Ft ██ rB0 ██████ nW ██</p>
        </div>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        {children}
      </div>
    </div>
  );
}
