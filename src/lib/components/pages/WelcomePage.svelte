<script lang="ts">
  /**
   * 欢迎页面组件 - 显示应用介绍和快捷键提示
   */
  import { Zap, Keyboard, Globe } from 'lucide-svelte';
  import { configStore } from '$lib/stores/config.svelte';
  import { APP_INFO } from '$lib/utils/constants';
  import { i18n } from '$lib/i18n';

  const t = i18n.t;

  function translate(key: string, params?: Record<string, string>) {
    let value = t(key);
    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        value = value.replace(`{${paramKey}}`, paramValue);
      }
    }
    return value;
  }

  function formatShortcut(hotkey: string): string {
    return hotkey
      .replace('CommandOrControl', 'Ctrl/Cmd')
      .replace('Alt', 'Alt')
      .replace('Shift', 'Shift')
      .replace(/\+/g, ' + ');
  }

  const features = [
    {
      icon: Zap,
      titleKey: 'welcome.features.quickTitle',
      descriptionKey: 'welcome.features.quickDescription'
    },
    {
      icon: Keyboard,
      titleKey: 'welcome.features.hotkeyTitle',
      descriptionKey: 'welcome.features.hotkeyDescription',
      needsShortcut: true
    },
    {
      icon: Globe,
      titleKey: 'welcome.features.translationTitle',
      descriptionKey: 'welcome.features.translationDescription'
    }
  ];
</script>

<div class="welcome-container">
  <div class="welcome-content">
    <!-- Logo和标题 -->
    <div class="header-section">
      <div class="logo">
        <svg class="logo-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h1 class="title">{APP_INFO.name}</h1>
      <p class="subtitle">{t('app.description')}</p>
      <p class="version">v{APP_INFO.version}</p>
    </div>

    <!-- 功能介绍 -->
    <div class="features-section">
      {#each features as feature}
        {@const Icon = feature.icon}
        <div class="feature-card">
          <div class="feature-icon">
            <Icon size={24} />
          </div>
          <h3 class="feature-title">{t(feature.titleKey)}</h3>
          <p class="feature-description">
            {feature.needsShortcut
              ? translate(feature.descriptionKey, {
                  shortcut: formatShortcut(configStore.config.globalHotkey)
                })
              : t(feature.descriptionKey)}
          </p>
        </div>
      {/each}
    </div>

    <!-- 使用提示 -->
    <div class="tips-section">
      <h2 class="tips-title">{t('welcome.tipsTitle')}</h2>
      <div class="tips-content">
        <div class="tip-item">
          <span class="tip-number">1</span>
          <span class="tip-text">{t('welcome.steps.step1')}</span>
        </div>
        <div class="tip-item">
          <span class="tip-number">2</span>
          <span class="tip-text">{t('welcome.steps.step2')}</span>
        </div>
        <div class="tip-item">
          <span class="tip-number">3</span>
          <span class="tip-text">{t('welcome.steps.step3')}</span>
        </div>
      </div>
    </div>

    <!-- 底部提示 -->
    <div class="footer-section">
      <p class="footer-text">
        {t('welcome.trayHint')}
      </p>
    </div>
  </div>
</div>

<style>
  .welcome-container {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .welcome-content {
    max-width: 800px;
    width: 100%;
  }

  .header-section {
    text-align: center;
    margin-bottom: 3rem;
  }

  .logo {
    margin: 0 auto 1.5rem;
    width: 80px;
    height: 80px;
    background: linear-gradient(135deg, var(--accent-color) 0%, #8B5CF6 100%);
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-lg);
    animation: float 3s ease-in-out infinite;
  }

  @keyframes float {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-10px);
    }
  }

  .logo-icon {
    width: 48px;
    height: 48px;
    color: white;
  }

  .title {
    font-size: 3rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 0.5rem 0;
    background: linear-gradient(135deg, var(--accent-color) 0%, #8B5CF6 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    font-size: 1.25rem;
    color: var(--text-secondary);
    margin: 0 0 0.5rem 0;
  }

  .version {
    font-size: 0.875rem;
    color: var(--text-tertiary);
    margin: 0;
  }

  .features-section {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.5rem;
    margin-bottom: 3rem;
  }

  .feature-card {
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 1.5rem;
    text-align: center;
    transition: all 0.3s ease;
    box-shadow: var(--shadow-sm);
  }

  .feature-card:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-lg);
    border-color: var(--accent-color);
  }

  .feature-icon {
    width: 48px;
    height: 48px;
    margin: 0 auto 1rem;
    background-color: var(--bg-secondary);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-color);
  }

  .feature-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 0.5rem 0;
  }

  .feature-description {
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
  }

  .tips-section {
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 2rem;
    margin-bottom: 2rem;
    box-shadow: var(--shadow-sm);
  }

  .tips-title {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 1.5rem 0;
    text-align: center;
  }

  .tips-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .tip-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background-color: var(--bg-secondary);
    border-radius: 8px;
    transition: all 0.2s ease;
  }

  .tip-item:hover {
    background-color: var(--bg-tertiary);
    transform: translateX(4px);
  }

  .tip-number {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, var(--accent-color) 0%, #8B5CF6 100%);
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    flex-shrink: 0;
  }

  .tip-text {
    font-size: 1rem;
    color: var(--text-primary);
    flex: 1;
  }

  .footer-section {
    text-align: center;
  }

  .footer-text {
    font-size: 0.875rem;
    color: var(--text-tertiary);
    margin: 0;
    line-height: 1.6;
  }

  /* 响应式设计 */
  @media (max-width: 768px) {
    .welcome-container {
      padding: 1rem;
    }

    .title {
      font-size: 2rem;
    }

    .subtitle {
      font-size: 1rem;
    }

    .features-section {
      grid-template-columns: 1fr;
    }

    .tips-section {
      padding: 1.5rem;
    }
  }
</style>
