<script lang="ts">
  import type { View } from './engine';

  interface Props {
    view: View;
  }

  let { view }: Props = $props();

  // The HP-12C shows six annunciators above the 10 character field.  They only
  // light while their prefix, mode or condition is active.  The label is what
  // the LCD prints; the key is the field the engine reports.
  const ANNUNCIATORS = [
    { label: 'f', key: 'f' },
    { label: 'g', key: 'g' },
    { label: 'BEGIN', key: 'begin' },
    { label: 'D.MY', key: 'dmy' },
    { label: 'C', key: 'c' },
    { label: 'PRGM', key: 'prgm' },
  ] as const satisfies readonly { label: string; key: keyof View['annunciators'] }[];
</script>

<div class="lcd" class:running={view.running}>
  <div class="annunciators">
    {#each ANNUNCIATORS as annunciator (annunciator.key)}
      <span class:lit={view.annunciators[annunciator.key] === true}>
        {annunciator.label}
      </span>
    {/each}
  </div>

  <div class="field">
    <span class="digits">{view.text}</span>
  </div>

  <div class="status">
    <span class:lit={view.programLine !== null}>{view.programLine ?? ''}</span>
  </div>
</div>

<style>
  .lcd {
    --lcd-bg: #9db3a6;
    --lcd-ink: #16241c;
    background: linear-gradient(180deg, #a8bdb0, var(--lcd-bg) 60%, #93a89b);
    border-radius: 4px 4px 3px 3px;
    border: 1px solid #7b8f83;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 45%),
      inset 0 -2px 6px rgb(0 0 0 / 18%);
    color: var(--lcd-ink);
    font-family: var(--mono);
    padding: 0.4rem 0.6rem 0.3rem;
    user-select: none;
  }

  .annunciators {
    display: flex;
    justify-content: space-between;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    height: 0.9rem;
  }

  .annunciators span {
    opacity: 0.18;
    transition: opacity 90ms linear;
  }

  .annunciators span.lit {
    opacity: 1;
  }

  .field {
    background: #8ea394;
    border-radius: 2px;
    box-shadow: inset 0 0 8px rgb(0 0 0 / 22%);
    padding: 0.15rem 0.35rem;
    overflow: hidden;
  }

  .digits {
    display: block;
    font-size: clamp(1.35rem, 7.5vw, 2rem);
    line-height: 1.15;
    letter-spacing: 0.04em;
    text-align: right;
    white-space: pre;
    font-variant-numeric: tabular-nums;
  }

  .status {
    height: 0.85rem;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-align: left;
    opacity: 0;
  }

  .status span.lit {
    opacity: 1;
  }

  /* A running program flashes the field, as the manual describes. */
  .lcd.running .digits {
    animation: blink 0.55s steps(1, end) infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0.15;
    }
  }
</style>