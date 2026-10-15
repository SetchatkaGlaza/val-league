import './styles/base.css';
import './styles/auth.css';
import './styles/doc.css';
import './styles/app.css';
import './styles/teams.css';
import { initBackground } from './js/background.js';
import { motion, $ } from './js/ui.js';
import { assets } from './js/layouts.js';
import { start, onSessionLost } from './js/app.js';
import { auth, IS_MOCK } from './js/api.js';
import { getUser, patchUser, clearUser } from './js/session.js';

// Фон создаётся один раз и живёт между всеми страницами — поэтому переходы не «мигают».
if (motion) initBackground($('#bg'));

start();

// Локальная копия профиля нужна только для интерфейса. В фоне сверяем её с сервером, страницу при этом не задерживаем.
if (!IS_MOCK && getUser()) {
  auth.me().then((r) => patchUser(r.user)).catch((e) => { if (e.status === 401) { clearUser(); onSessionLost(); } });
}

// Когда браузер освободится, заранее грузим картинки обоих каркасов, чтобы первый переход не моргал.
const warm = () => Object.values(assets).forEach((src) => { const i = new Image(); i.src = src; });
if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 3000 });
else setTimeout(warm, 1200);
