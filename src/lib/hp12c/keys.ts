// HP-12C keyboard.
//
// Geometry and labels follow the classic HP-12C: four rows of ten keys with
// ENTER double height, bridging rows 3 and 4 of column 6.  Each key carries a
// primary function (white, on the key face), a gold function (`f` + key) and a
// blue function (`g` + key).
//
// Keycodes are the two digit identifiers the HP-12C stores in program memory:
// row number first, then position in the row where the tenth key uses `0`.

export interface KeyDef {
  id: string;
  /** white legend on the key face */
  primary: string;
  /** gold legend printed above the key, reached with `f` */
  gold?: string;
  /** blue legend printed on the lower face of the key, reached with `g` */
  blue?: string;
  /** keycode stored in program memory */
  code: string;
  /** styling hook */
  variant?: 'op' | 'shift' | 'tvm' | 'on' | 'enter';
}

export const KEYS: Record<string, KeyDef> = {
  // row 1
  n: { id: 'n', primary: 'n', gold: 'AMORT', blue: '12x', code: '11', variant: 'tvm' },
  i: { id: 'i', primary: 'I/YR', gold: 'INT', blue: '12÷', code: '12', variant: 'tvm' },
  PV: { id: 'PV', primary: 'PV', gold: 'NPV', blue: 'CFo', code: '13', variant: 'tvm' },
  PMT: { id: 'PMT', primary: 'PMT', gold: 'RND', blue: 'CFj', code: '14', variant: 'tvm' },
  FV: { id: 'FV', primary: 'FV', gold: 'IRR', blue: 'Nj', code: '15', variant: 'tvm' },
  CHS: { id: 'CHS', primary: 'CHS', blue: 'DATE', code: '16' },
  d7: { id: 'd7', primary: '7', blue: 'BEG', code: '7' },
  d8: { id: 'd8', primary: '8', blue: 'END', code: '8' },
  d9: { id: 'd9', primary: '9', blue: 'MEM', code: '9' },
  div: { id: 'div', primary: '÷', code: '10', variant: 'op' },

  // row 2
  yx: { id: 'yx', primary: 'yˣ', gold: 'PRICE', blue: '√x', code: '21' },
  inv: { id: 'inv', primary: '1/x', gold: 'YTM', blue: 'eˣ', code: '22' },
  pctT: { id: 'pctT', primary: '%T', gold: 'SL', blue: 'LN', code: '23' },
  pctD: { id: 'pctD', primary: 'Δ%', gold: 'SOYD', blue: 'FRAC', code: '24' },
  pct: { id: 'pct', primary: '%', gold: 'DB', blue: 'INTG', code: '25' },
  EEX: { id: 'EEX', primary: 'EEX', blue: 'ΔDAYS', code: '26' },
  d4: { id: 'd4', primary: '4', blue: 'D.MY', code: '4' },
  d5: { id: 'd5', primary: '5', blue: 'M.DY', code: '5' },
  d6: { id: 'd6', primary: '6', blue: 'x̄,w', code: '6' },
  mul: { id: 'mul', primary: '×', code: '20', variant: 'op' },

  // row 3
  RS: { id: 'RS', primary: 'R/S', gold: 'P/R', blue: 'PSE', code: '31', variant: 'op' },
  SST: { id: 'SST', primary: 'SST', gold: 'Σ', blue: 'BST', code: '32', variant: 'op' },
  Rv: { id: 'Rv', primary: 'R↓', gold: 'PRGM', blue: 'GTO', code: '33', variant: 'op' },
  xy: { id: 'xy', primary: 'x≷y', gold: 'FIN', blue: 'x≤y', code: '34', variant: 'op' },
  CLx: { id: 'CLx', primary: 'CLx', gold: 'REG', blue: 'x=0', code: '35', variant: 'op' },
  ENTER: { id: 'ENTER', primary: 'ENTER', gold: 'PREFIX', blue: 'LSTx', code: '36', variant: 'enter' },
  d1: { id: 'd1', primary: '1', blue: 'x̂,r', code: '1' },
  d2: { id: 'd2', primary: '2', blue: 'ŷ,r', code: '2' },
  d3: { id: 'd3', primary: '3', blue: 'n!', code: '3' },
  sub: { id: 'sub', primary: '−', code: '30', variant: 'op' },

  // row 4
  ON: { id: 'ON', primary: 'ON', code: '41', variant: 'on' },
  f: { id: 'f', primary: 'f', code: '42', variant: 'shift' },
  g: { id: 'g', primary: 'g', code: '43', variant: 'shift' },
  STO: { id: 'STO', primary: 'STO', code: '44', variant: 'shift' },
  RCL: { id: 'RCL', primary: 'RCL', code: '45', variant: 'shift' },
  d0: { id: 'd0', primary: '0', blue: 'x̄', code: '0' },
  dot: { id: 'dot', primary: '.', blue: 's', code: '48' },
  sigPlus: { id: 'sigPlus', primary: 'Σ+', blue: 'Σ−', code: '49', variant: 'op' },
  add: { id: 'add', primary: '+', code: '40', variant: 'op' },
};

/**
 * Physical layout, row by row.  ENTER occupies the sixth column of rows three
 * and four, which is why `ENTER` is listed once and the grid below repeats it.
 */
export const KEY_ROWS: string[][] = [
  ['n', 'i', 'PV', 'PMT', 'FV', 'CHS', 'd7', 'd8', 'd9', 'div'],
  ['yx', 'inv', 'pctT', 'pctD', 'pct', 'EEX', 'd4', 'd5', 'd6', 'mul'],
  ['RS', 'SST', 'Rv', 'xy', 'CLx', 'ENTER', 'd1', 'd2', 'd3', 'sub'],
  ['ON', 'f', 'g', 'STO', 'RCL', 'ENTER', 'd0', 'dot', 'sigPlus', 'add'],
];

export const DIGIT_KEYS: Record<string, string> = {
  d0: '0',
  d1: '1',
  d2: '2',
  d3: '3',
  d4: '4',
  d5: '5',
  d6: '6',
  d7: '7',
  d8: '8',
  d9: '9',
};

/** Physical key => keycode, for typing and for program listings. */
export const KEYCODE_TO_ID = new Map<string, string>(
  Object.values(KEYS).map((k) => [k.code, k.id]),
);

/** Reverse lookup: keycode => key id, digits included. */
export function idForKeycode(code: string): string | undefined {
  return KEYCODE_TO_ID.get(code);
}