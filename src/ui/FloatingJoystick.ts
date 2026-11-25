export interface JoystickOutput {
  x: number; // -1..+1
  y: number; // -1..+1 (+1 = up/forward)
  sprint: boolean;
  active: boolean;
}

/**
 * 360-degree analog touch thumbstick for natural walking/sprinting on mobile.
 * Tracks its own pointerId so multi-touch camera look on the right side never collides.
 */
export class FloatingJoystick {
  private zoneEl: HTMLElement;
  private baseEl: HTMLElement;
  private knobEl: HTMLElement;

  private activePointerId: number | null = null;
  private centerX = 0;
  private centerY = 0;
  private readonly maxRadius = 46;

  public value: JoystickOutput = { x: 0, y: 0, sprint: false, active: false };

  constructor(zoneId: string) {
    this.zoneEl = document.getElementById(zoneId)!;

    this.baseEl = document.createElement('div');
    this.baseEl.className = 'joystick-base';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'joystick-knob';
    this.baseEl.appendChild(this.knobEl);
    this.zoneEl.appendChild(this.baseEl);

    this.bindEvents();
  }

  private bindEvents(): void {
    this.zoneEl.addEventListener('pointerdown', (e) => {
      if (this.activePointerId !== null) return;
      e.preventDefault();
      e.stopPropagation();
      this.activePointerId = e.pointerId;
      this.zoneEl.setPointerCapture(e.pointerId);

      const rect = this.zoneEl.getBoundingClientRect();
      this.centerX = rect.left + rect.width * 0.5;
      this.centerY = rect.top + rect.height * 0.5;
      this.updateFromPoint(e.clientX, e.clientY);
    });

    this.zoneEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.activePointerId) return;
      e.preventDefault();
      this.updateFromPoint(e.clientX, e.clientY);
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointerId) return;
      this.activePointerId = null;
      this.reset();
    };

    this.zoneEl.addEventListener('pointerup', release);
    this.zoneEl.addEventListener('pointercancel', release);
  }

  private updateFromPoint(px: number, py: number): void {
    const dx = px - this.centerX;
    const dy = py - this.centerY;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(this.maxRadius, dist);
    const angle = Math.atan2(dy, dx);

    const kx = Math.cos(angle) * clamped;
    const ky = Math.sin(angle) * clamped;
    this.knobEl.style.transform = `translate(${kx}px, ${ky}px)`;

    const norm = clamped / this.maxRadius;
    if (norm < 0.14) {
      this.value.x = 0;
      this.value.y = 0;
      this.value.sprint = false;
      this.value.active = true;
      this.baseEl.classList.remove('sprinting');
      return;
    }

    this.value.x = kx / this.maxRadius;
    this.value.y = -ky / this.maxRadius;
    this.value.sprint = norm > 0.78;
    this.value.active = true;
    this.baseEl.classList.toggle('sprinting', this.value.sprint);
  }

  public reset(): void {
    this.value.x = 0;
    this.value.y = 0;
    this.value.sprint = false;
    this.value.active = false;
    this.knobEl.style.transform = 'translate(0px, 0px)';
    this.baseEl.classList.remove('sprinting');
  }
}
