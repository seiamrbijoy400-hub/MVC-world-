import { DEFAULT_APPEARANCE_BY_ID } from '../graphics/AnimeCharacterMesh';
import type {
  AccessoryId,
  CharacterAppearance,
  CharacterId,
  HairStyleId
} from '../network/LobbyProtocol';

const STORAGE_KEY = 'zenvo_avatar_v1';

const HAIR_STYLES: { id: HairStyleId; label: string }[] = [
  { id: 'spiky', label: 'Spiky' },
  { id: 'twintails', label: 'Twin-Tails' },
  { id: 'ponytail', label: 'Ponytail' },
  { id: 'bob', label: 'Street Bob' },
  { id: 'cyber', label: 'Cyber Fin' }
];

const ACCESSORIES: { id: AccessoryId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'headphones', label: 'Audio' },
  { id: 'visor', label: 'Visor' },
  { id: 'sunglasses', label: 'Shades' },
  { id: 'wing', label: 'Nitro Pack' }
];

const HAIR_COLORS = ['#1e293b', '#f472b6', '#38bdf8', '#facc15', '#dc2626', '#f8fafc', '#a855f7'];
const EYE_COLORS = ['#f97316', '#ec4899', '#06b6d4', '#eab308', '#22c55e', '#ef4444'];
const JACKET_COLORS = ['#ff5500', '#1e1b4b', '#1d4ed8', '#dc2626', '#18181b', '#16a34a', '#9333ea'];
const SKIN_COLORS = ['#ffeadb', '#ffe0c8', '#f5cba7', '#d9a074', '#8d5524'];

export class CharacterStudio {
  private modal: HTMLElement;
  private bodyEl: HTMLElement;
  public appearance: CharacterAppearance;
  public isOpen = false;

  public onChange: (app: CharacterAppearance) => void = () => {};
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

  public open(show: boolean): void {
    this.isOpen = show;
    this.modal.classList.toggle('open', show);
    this.onToggle(show);
  }

  public applyPreset(charId: CharacterId): void {
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
      this.appearance = {
        hairStyle: pick(HAIR_STYLES).id,
        hairColor: pick(HAIR_COLORS),
        eyeColor: pick(EYE_COLORS),
        jacketColor: pick(JACKET_COLORS),
        accentColor: pick(['#f8fafc', '#22d3ee', '#facc15', '#f43f5e']),
        pantsColor: pick(['#0f172a', '#18181b', '#1e293b']),
        skinColor: pick(SKIN_COLORS),
        accessory: pick(ACCESSORIES).id
      };
      this.save();
      this.renderControls();
      this.onChange({ ...this.appearance });
    });
  }

  private renderControls(): void {
    const swatchRow = (key: keyof CharacterAppearance, colors: string[]) => `
      <div class="color-picker-row" style="flex-wrap:wrap;">
        ${colors.map(c => `
          <div class="color-swatch ${this.appearance[key] === c ? 'selected' : ''}"
               data-studio-key="${key}" data-studio-val="${c}"
               style="background:${c};width:28px;height:28px;"></div>
        `).join('')}
      </div>
    `;

    const chipRow = (key: keyof CharacterAppearance, items: { id: string; label: string }[]) => `
      <div class="options-row" style="flex-wrap:wrap;">
        ${items.map(it => `
          <button class="option-btn ${this.appearance[key] === it.id ? 'selected' : ''}"
                  data-studio-key="${key}" data-studio-val="${it.id}"
                  style="flex:0 0 auto;padding:6px 10px;">${it.label}</button>
        `).join('')}
      </div>
    `;

    this.bodyEl.innerHTML = `
      <div class="setting-group">
        <label>Hairstyle</label>
        ${chipRow('hairStyle', HAIR_STYLES)}
      </div>
      <div class="setting-group">
        <label>Hair Color</label>
        ${swatchRow('hairColor', HAIR_COLORS)}
      </div>
      <div class="setting-group">
        <label>Anime Eye Color</label>
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
      <div class="setting-group">
        <label>Accessory</label>
        ${chipRow('accessory', ACCESSORIES)}
      </div>
    `;

    this.bodyEl.querySelectorAll('[data-studio-key]').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-studio-key') as keyof CharacterAppearance;
        const val = el.getAttribute('data-studio-val')!;
        this.updateField(key, val as never);
      });
    });
  }
}
