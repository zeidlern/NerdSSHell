'use strict';
// Shared, data-only color settings for the renderer and validated main-process storage.
(() => {
  const baseColors = Object.freeze({ terminalBackground: '#000000', uiBackground: '#242328', accent: '#00aaf0', text: '#f5f5f5' });
  const colorKeys = Object.freeze(['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite']);
  const presets = Object.freeze({
    Classic: Object.freeze(['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf', '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec']),
    Vivid: Object.freeze(['#000000', '#bb0000', '#00bb00', '#bbbb00', '#0000bb', '#bb00bb', '#00bbbb', '#bbbbbb', '#555555', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff']),
    Soft: Object.freeze(['#202124', '#e87878', '#91c78a', '#dfc278', '#8ab4e8', '#c99bdd', '#82c9c9', '#d9dde3', '#707580', '#ffa0a0', '#b5e6aa', '#f5df9a', '#b3d1fa', '#e4b8f0', '#a5e4e4', '#ffffff'])
  });
  const extended = Object.freeze(Array.from({ length: 240 }, (_, offset) => {
    const index = offset + 16;
    if (index >= 232) return '#' + (8 + (index - 232) * 10).toString(16).padStart(2, '0').repeat(3);
    const n = index - 16, levels = [0, 95, 135, 175, 215, 255];
    return '#' + [Math.floor(n / 36), Math.floor(n / 6) % 6, n % 6].map(i => levels[i].toString(16).padStart(2, '0')).join('');
  }));
  function presetPalette(name = 'Classic') {
    if (!Object.hasOwn(presets, name)) throw new Error('Unknown terminal palette.');
    return { ...Object.fromEntries(colorKeys.map((key, i) => [key, presets[name][i]])), extendedAnsi: [...extended] };
  }
  function color(value, name) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid ${name} color.`);
    return value.toLowerCase();
  }
  function appearance(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid appearance settings.');
    const result = Object.fromEntries(Object.entries(baseColors).map(([key, fallback]) => [key, color(value[key] ?? fallback, key)]));
    const copyOnSelect = value.copyOnSelect === undefined ? true : value.copyOnSelect;
    if (typeof copyOnSelect !== 'boolean') throw new Error('Copy-on-selection must be on or off.');
    result.copyOnSelect = copyOnSelect;
    const palette = value.palette === undefined ? {} : value.palette;
    if (!palette || typeof palette !== 'object' || Array.isArray(palette)) throw new Error('Invalid terminal palette.');
    const defaults = presetPalette();
    result.palette = Object.fromEntries(colorKeys.map(key => [key, color(palette[key] ?? defaults[key], key)]));
    const indexed = palette.extendedAnsi === undefined ? extended : palette.extendedAnsi;
    if (!Array.isArray(indexed) || indexed.length !== 240) throw new Error('Terminal palette requires exactly 240 indexed colors.');
    result.palette.extendedAnsi = Array.from(indexed, (value, i) => color(value, `indexed ${i + 16}`));
    return result;
  }
  // Labels identify the actual terminal color slot, not a universal syntax role.
  const paletteLabels = Object.freeze([
    'Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White',
    'Gray (bright black)', 'Bright red', 'Bright green', 'Bright yellow',
    'Bright blue', 'Bright magenta', 'Bright cyan', 'Bright white'
  ]);
  const exampleRoles = Object.freeze({ brightBlack: 'Comments', magenta: 'Keywords',
    blue: 'Function names', green: 'Strings', cyan: 'Variables', yellow: 'Numbers',
    red: 'Errors', brightGreen: 'Success messages', brightYellow: 'Warnings' });
  const settings = Object.freeze({ baseColors, colorKeys, presets, presetPalette, appearance, paletteLabels, exampleRoles });
  if (typeof module === 'object' && module.exports) module.exports = settings;
  else globalThis.NerdSSHellAppearance = settings;
})();
