<script lang="ts">
  import { KEYS, KEY_ROWS, type KeyDef } from './keys';

  interface Props {
    onpress: (id: string) => void;
  }

  let { onpress }: Props = $props();

  interface Cell {
    key: KeyDef;
    row: number;
    column: number;
    /** ENTER bridges the last two rows of column six */
    span: number;
  }

  // The classic layout is four rows of ten keys, but ENTER is double height, so
  // the sixth cell of the last two rows is one key rather than two.
  const cells: Cell[] = KEY_ROWS.flatMap((row, r) =>
    row.flatMap((id, c) => {
      const enter = id === 'ENTER';
      // the lower ENTER slot is the same physical key as the upper one
      if (enter && r === 3) return [];
      return [{ key: KEYS[id], row: r + 1, column: c + 1, span: enter ? 2 : 1 }];
    }),
  );

  function press(id: string) {
    return (e: PointerEvent) => {
      // Keep a held key from turning into a text selection or a focus ring.
      e.preventDefault();
      (e.currentTarget as HTMLButtonElement).blur();
      onpress(id);
    };
  }
</script>

<div class="keypad">
  {#each cells as cell (cell.key.id)}
    <button
      type="button"
      class="key {cell.key.variant ?? ''}"
      style:grid-row="{cell.row} / span {cell.span}"
      style:grid-column={cell.column}
      aria-label={cell.key.primary}
      onpointerdown={press(cell.key.id)}
    >
      {#if cell.key.gold}<span class="gold">{cell.key.gold}</span>{/if}
      <span class="face">{cell.key.primary}</span>
      {#if cell.key.blue}<span class="blue">{cell.key.blue}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .keypad {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    grid-template-rows: repeat(4, auto);
    gap: 0.3rem;
  }

  .key {
    appearance: none;
    border: 0;
    border-radius: 5px;
    padding: 0.28rem 0.1rem 0.22rem;
    min-height: 3rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 0.12rem;
    cursor: pointer;
    background: linear-gradient(180deg, #4a4d52, #2f3134);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 22%),
      0 1px 0 rgb(0 0 0 / 45%);
    color: #f2f3f5;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .key:active {
    transform: translateY(1px);
    box-shadow: inset 0 2px 5px rgb(0 0 0 / 45%);
  }

  .key.op {
    background: linear-gradient(180deg, #56595e, #383a3e);
  }

  .key.tvm {
    background: linear-gradient(180deg, #4f5258, #33353a);
  }

  .key.on {
    background: linear-gradient(180deg, #8d3b32, #6d2b24);
  }

  .key.shift {
    background: linear-gradient(180deg, #5a5348, #3d382f);
  }

  .key.enter {
    background: linear-gradient(180deg, #4a5c6b, #2f3d48);
  }

  .face {
    font-size: 0.78rem;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
  }

  .gold,
  .blue {
    font-size: 0.55rem;
    line-height: 1;
    white-space: nowrap;
  }

  .gold {
    color: #e8c877;
  }

  .blue {
    color: #7fb6e8;
  }

  @media (max-width: 34rem) {
    .keypad {
      gap: 0.18rem;
    }

    .key {
      min-height: 2.4rem;
      padding: 0.18rem 0.04rem;
    }

    .face {
      font-size: 0.66rem;
    }

    .gold,
    .blue {
      font-size: 0.44rem;
    }
  }
</style>