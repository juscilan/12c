<script lang="ts">
  import Display from './lib/hp12c/Display.svelte';
  import Keypad from './lib/hp12c/Keypad.svelte';
  import { Hp12c } from './lib/hp12c/engine';

  const calculator = new Hp12c();

  // The engine has no reactivity of its own, so a version counter nudges Svelte
  // to re-read the view after every key press.
  let version = $state(0);
  const view = $derived.by(() => {
    void version;
    return calculator.view();
  });

  function press(id: string) {
    calculator.press(id);
    version += 1;
  }

  // The physical keyboard drives the same engine, so a number row or an arrow
  // key does what the matching calculator key does.
  const TYPED: Record<string, string> = {
    '+': 'add',
    '-': 'sub',
    '*': 'mul',
    x: 'mul',
    '/': 'div',
    '.': 'dot',
    ',': 'dot',
    Enter: 'ENTER',
    Backspace: 'CLx',
    Escape: 'CLx',
    Delete: 'CLx',
    '%': 'pct',
    '=': 'add',
  };

  function fromKeyboard(event: KeyboardEvent): string | null {
    if (event.metaKey || event.ctrlKey || event.altKey) return null;
    const { key } = event;
    if (/^[0-9]$/.test(key)) return `d${key}`;
    if (/^[a-zA-Z]$/.test(key)) {
      const id = key.toUpperCase();
      const named: Record<string, string> = {
        N: 'n',
        I: 'i',
        V: 'PV',
        P: 'PMT',
        F: 'FV',
        C: 'CHS',
        R: 'Rv',
        X: 'xy',
        S: 'RS',
        T: 'STO',
        L: 'RCL',
        O: 'ON',
        E: 'EEX',
      };
      return named[id] ?? null;
    }
    return TYPED[key] ?? null;
  }

  function onKeydown(event: KeyboardEvent) {
    const id = fromKeyboard(event);
    if (!id) return;
    event.preventDefault();
    press(id);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="desk">
  <div class="calculator">
    <header class="brand">
      <span class="model">hp</span>
      <span class="name">12C</span>
    </header>

    <Display {view} />

    <div class="branding-strip">
      <span>FINANCIAL CALCULATOR</span>
    </div>

    <Keypad onpress={press} />

    <footer class="plate">
      <span>HEWLETT·PACKARD</span>
      <span class="model-no">12C</span>
    </footer>
  </div>

  <p class="hint">
    Click the keys, or use the keyboard: digits, <kbd>+</kbd> <kbd>-</kbd> <kbd>*</kbd>
    <kbd>/</kbd>, <kbd>Enter</kbd>, and <kbd>Esc</kbd> for CLx.
  </p>
</div>

<style>
  .desk {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1.25rem 0.75rem;
  }

  .calculator {
    width: min(26rem, 100%);
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.85rem 0.85rem 0.7rem;
    border-radius: 12px;
    background: linear-gradient(160deg, #d9dbdd, #b9bcbf 55%, #a3a6a9);
    box-shadow:
      0 1px 0 rgb(255 255 255 / 70%) inset,
      0 18px 30px -12px rgb(0 0 0 / 45%),
      0 2px 6px rgb(0 0 0 / 25%);
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    font-family: var(--mono);
    color: #2b2d30;
  }

  .brand .model {
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: -0.04em;
  }

  .brand .name {
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.06em;
  }

  .branding-strip {
    text-align: center;
    font-size: 0.56rem;
    letter-spacing: 0.24em;
    color: #4a4d51;
    padding: 0.1rem 0;
    border-top: 1px solid rgb(0 0 0 / 8%);
    border-bottom: 1px solid rgb(0 0 0 / 8%);
  }

  .plate {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: 0.52rem;
    letter-spacing: 0.18em;
    color: #56595d;
    padding-top: 0.15rem;
  }

  .plate .model-no {
    font-weight: 700;
  }

  .hint {
    margin: 0;
    max-width: 26rem;
    text-align: center;
    font-size: 0.75rem;
    line-height: 1.5;
    color: #6c7075;
  }

  kbd {
    font-family: var(--mono);
    font-size: 0.7rem;
    padding: 0.05rem 0.25rem;
    border-radius: 3px;
    border: 1px solid #c3c6c9;
    background: #eef0f1;
  }
</style>