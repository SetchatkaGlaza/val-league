/** Общие куски разметки форм. */
export const ICON = {
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3zM3 7l9 6 9-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 10V8a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path class="slash" d="M4 4l16 16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  steam: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-9.96 9.1l5.35 2.2a2.8 2.8 0 0 1 1.6-.5h.15l2.38-3.45v-.05a3.75 3.75 0 1 1 3.75 3.75h-.09l-3.4 2.43a2.8 2.8 0 0 1-5.55.4L2.4 14.2A10 10 0 1 0 12 2Zm-3.9 15.4-1.2-.5a2.1 2.1 0 0 0 4-.55 2.1 2.1 0 0 0-2.8-1.95l1.24.51a1.55 1.55 0 1 1-1.2 2.9Zm8.05-5.7a2.5 2.5 0 1 0-2.5-2.5 2.5 2.5 0 0 0 2.5 2.5Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5M12 16.5v.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
  mailBig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18v12H3zM3 7l9 6 9-6"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
};

export const emailField = (autocomplete = 'email', name = 'email') => `
<div class="field reveal-field" data-field="${name}">
  <label for="${name}">Почта</label>
  <div class="control">
    ${ICON.mail}
    <input id="${name}" name="${name}" type="email" inputmode="email" autocomplete="${autocomplete}" placeholder="you@example.com" maxlength="254" required aria-describedby="${name}-err" />
  </div>
  <p class="err" id="${name}-err" role="alert"></p>
</div>`;

export const passwordField = ({ name, label, placeholder, autocomplete, strength = false }) => `
<div class="field reveal-field" data-field="${name}">
  <label for="${name}">${label}</label>
  <div class="control">
    ${ICON.lock}
    <input id="${name}" name="${name}" type="password" autocomplete="${autocomplete}" placeholder="${placeholder}" maxlength="128" required aria-describedby="${name}-err" />
    <button type="button" class="eye" data-target="${name}" aria-label="Показать пароль" aria-pressed="false">${ICON.eye}</button>
  </div>
  <p class="hint" data-caps="${name}" hidden>Включён Caps Lock</p>
  ${strength ? '<div class="strength" id="strength" data-level="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div><p class="strength-label" id="strengthLabel"></p>' : ''}
  <p class="err" id="${name}-err" role="alert"></p>
</div>`;

export const submitBtn = (label) => `<button type="submit" class="btn btn-primary reveal-field" id="submitBtn"><span class="label">${label}</span><span class="spinner" aria-hidden="true"></span></button>`;
export const bannerEl = '<div class="banner" id="banner" role="alert" hidden></div>';

export const STRENGTH_LABELS = ['', 'Слабый пароль', 'Средний пароль', 'Хороший пароль', 'Надёжный пароль'];
