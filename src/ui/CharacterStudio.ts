import { DEFAULT_APPEARANCE_BY_ID } from '../graphics/HumanCharacterMesh';
import type {
  AccessoryId,
  CharacterAppearance,
  CharacterId,
  HairStyleId
} from '../network/LobbyProtocol';

const STORAGE_KEY = 'zenvo_avatar_v1';

const HAIR_STYLES: { id: HairStyleId; label: string }[] = [
  { id: 'spiky', label: 'Textured Crop' },
  { id: 'twintails', label: 'Twin Braids' },
  { id: 'ponytail', label: 'Low Ponytail' },
  { id: 'bob', label: 'Street Bob' },
  { id: 'cyber', label: 'Slick Back' }
];

const ACCESSORIES: { id: AccessoryId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'headphones', label: 'Audio' },
  { id: 'visor', label: 'Visor' },
  { id: 'sunglasses', label: 'Shades' },
  { id: 'wing', label: 'Nitro Pack' }
];

const CHARACTER_OPTIONS: { id: CharacterId; name: string; role: string; dot: string }[] = [
  { id: 'kaito', name: 'Kaito', role: 'Street Racer', dot: '#ff5500' },
  { id: 'mika', name: 'Mika', role: 'Drift Queen', dot: '#ec4899' },
  { id: 'ren', name: 'Ren', role: 'Cyber Pilot', dot: '#38bdf8' },
  { id: 'sora', name: 'Sora', role: 'Stunt Ace', dot: '#facc15' }
];

const HAIR_COLORS = ['#1c1917', '#3b2a20', '#6b4a2f', '#a16207', '#7f1d1d', '#9ca3af', '#2f3e46'];
const EYE_COLORS = ['#4a2f1b', '#6b4423', '#3f6212', '#1e3a8a', '#0f172a', '#7c2d12'];
const JACKET_COLORS = ['#c2410c', '#1e1b4b', '#1d4ed8', '#7f1d1d', '#18181b', '#166534', '#4c1d95'];
const SKIN_COLORS = ['#f2d3b6', '#e0b48c', '#c68a5e', '#a1663f', '#6b4529'];

export class CharacterStudio {
  private modal: HTMLElement;
  private bodyEl: HTMLElement;
  public appearance: CharacterAppearance;
  public characterId: CharacterId = 'kaito';
  public isOpen = false;
  /** Rigged GLBs support color tints but not procedural hairstyle/accessory geometry. */
  private rigged = false;

  public onChange: (app: CharacterAppearance) => void = () => {};
  public onCharacterChange: (id: CharacterId) => void = () => {};
  public onToggle: (open: boolean) => void = () => {};

  constructor() {
    this.modal = document.getElementById('studio-modal')!;
    this.bodyEl = document.getElementById('studio-body')!;
    this.appearance = this.loadSaved();
    this.renderControls();
    this.bindClose();
  }

  private loadSaved(): CharacterAppearance {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return { ...DEFAULT_APPEARANCE_BY_ID.kaito, ...JSON.parse(raw) };
      }
    } catch {}
    return { ...DEFAULT_APPEARANCE_BY_ID.kaito };
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.appearance));
    } catch {}
  }

  public setRigged(rigged: boolean): void {
    if (this.rigged === rigged) return;
    this.rigged = rigged;
    this.renderControls();
  }

  public open(show: boolean): void {
    this.isOpen = show;
    this.modal.classList.toggle('open', show);
    this.onToggle(show);
  }

  public applyPreset(charId: CharacterId): void {
    this.characterId = charId;
    this.appearance = { ...DEFAULT_APPEARANCE_BY_ID[charId] };
    this.save();
    this.renderControls();
    this.onChange({ ...this.appearance });
  }

  private updateField<K extends keyof CharacterAppearance>(key: K, val: CharacterAppearance[K]): void {
    this.appearance[key] = val;
    this.save();
    this.renderControls();
    this.onChange({ ...this.appearance });
  }

  private bindClose(): void {
    document.getElementById('studio-close-btn')?.addEventListener('click', () => this.open(false));
    document.getElementById('studio-done-btn')?.addEventListener('click', () => this.open(false));
    document.getElementById('studio-random-btn')?.addEventListener('click', () => {
      const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
      // Rigged GLBs bake hair shape and accessories; only randomize the knobs
      // the player can actually see and change in this mode.
      this.appearance = {
        ...this.appearance,
        ...(this.rigged ? {} : {
          hairStyle: pick(HAIR_STYLES).id,
          accessory: pick(ACCESSORIES).id
        }),
        hairColor: pick(HAIR_COLORS),
        eyeColor: pick(EYE_COLORS),
        jacketColor: pick(JACKET_COLORS),
        accentColor: pick(['#f8fafc', '#22d3ee', '#facc15', '#f43f5e']),
        pantsColor: pick(['#0f172a', '#18181b', '#1e293b']),
        skinColor: pick(SKIN_COLORS)
      };
      this.save();
      this.renderControls();
      this.onChange({ ...this.appearance });
    });
  }

  private renderControls(): void {
    // Preserve keyboard focus across the full re-render triggered by a pick.
    const active = document.activeElement as HTMLElement | null;
    const focusedKey = active?.getAttribute('data-studio-key');
    const focusedVal = active?.getAttribute('data-studio-val');

    const swatchRow = (key: keyof CharacterAppearance, colors: string[]) => `
      <div class="color-picker-row" style="flex-wrap:wrap;">
        ${colors.map(c => `
          <button type="button" class="color-swatch ${this.appearance[key] === c ? 'selected' : ''}"
               data-studio-key="${key}" data-studio-val="${c}"
               aria-label="${key} ${c}" aria-pressed="${this.appearance[key] === c}"
               style="background:${c};width:28px;height:28px;"></button>
        `).join('')}
      </div>
    `;

    const chipRow = (key: keyof CharacterAppearance, items: { id: string; label: string }[]) => `
      <div class="options-row" style="flex-wrap:wrap;">
        ${items.map(it => `
          <button type="button" class="option-btn ${this.appearance[key] === it.id ? 'selected' : ''}"
                  data-studio-key="${key}" data-studio-val="${it.id}"
                  aria-pressed="${this.appearance[key] === it.id}"
                  style="flex:0 0 auto;padding:6px 10px;">${it.label}</button>
        `).join('')}
      </div>
    `;

    const characterRow = `
      <div class="setting-group">
        <label>Driver Character</label>
        <div class="studio-char-grid">
          ${CHARACTER_OPTIONS.map(c => `
            <button type="button" class="char-card ${this.characterId === c.id ? 'selected' : ''}"
                    data-studio-key="characterId" data-studio-val="${c.id}"
                    aria-label="${c.name}, ${c.role}" aria-pressed="${this.characterId === c.id}">
              <div class="char-dot" style="background:${c.dot};"></div>
              <div class="char-name">${c.name}</div>
              <div class="char-role">${c.role}</div>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    this.bodyEl.innerHTML = `
      ${characterRow}
      ${this.rigged ? '' : `
      <div class="setting-group">
        <label>Hairstyle</label>
        ${chipRow('hairStyle', HAIR_STYLES)}
      </div>`}
      <div class="setting-group">
        <label>Hair Color</label>
        ${swatchRow('hairColor', HAIR_COLORS)}
      </div>
      <div class="setting-group">
        <label>Eye Color</label>
        ${swatchRow('eyeColor', EYE_COLORS)}
      </div>
      <div class="setting-group">
        <label>Jacket Color</label>
        ${swatchRow('jacketColor', JACKET_COLORS)}
      </div>
      <div class="setting-group">
        <label>Skin Tone</label>
        ${swatchRow('skinColor', SKIN_COLORS)}
      </div>
      ${this.rigged ? `
      <div class="setting-group">
        <label>Model Notes</label>
        <div style="font-size:10px;line-height:1.45;color:#94a3b8;">
          Rigged GLB character: color changes apply live. Hair shape and accessories are baked into the model, so those controls are hidden.
        </div>
      </div>` : `
      <div class="setting-group">
        <label>Accessory</label>
        ${chipRow('accessory', ACCESSORIES)}
      </div>`}
    `;

    this.bodyEl.querySelectorAll('[data-studio-key]').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-studio-key')!;
        const val = el.getAttribute('data-studio-val')!;
        if (key === 'characterId') {
          const id = val as CharacterId;
          if (id === this.characterId) return;
          this.applyPreset(id);
          this.onCharacterChange(id);
          return;
        }
        this.updateField(key as keyof CharacterAppearance, val as never);
      });
    });

    if (focusedKey && focusedVal) {
      const selector = `[data-studio-key="${CSS.escape(focusedKey)}"][data-studio-val="${CSS.escape(focusedVal)}"]`;
      this.bodyEl.querySelector<HTMLElement>(selector)?.focus();
    }
  }
}
