<script lang="ts">
  /**
   * 欢迎页面组件 - 显示应用介绍和快捷键提示
   */
  import { Zap, Keyboard, Globe } from 'lucide-svelte';
  import { configStore } from '$lib/stores/config.svelte';
  import { APP_INFO } from '$lib/utils/constants';

  const features = [
    {
      icon: Zap,
      title: '快速访问',
      description: '点击左侧图标快速切换不同的AI平台'
    },
    {
      icon: Keyboard,
      title: '快捷键支持',
      description: `使用 ${configStore.config.globalHotkey.replace('CommandOrControl', 'Ctrl')} 快速显示/隐藏窗口`
    },
    {
      icon: Globe,
      title: '翻译功能',
      description: '内置多个翻译平台，点击左下角翻译图标使用'
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
      <p class="subtitle">{APP_INFO.description}</p>
      <p class="version">v{APP_INFO.version}</p>
    </div>

    <!-- 功能介绍 -->
    <div class="features-section">
      {#each features as feature}
        <div class="feature-card">
          <div class="feature-icon">
            <svelte:component this={feature.icon} size={24} />
          </div>
          <h3 class="feature-title">{feature.title}</h3>
          <p class="feature-description">{feature.description}</p>
        </div>
      {/each}
    </div>

    <!-- 使用提示 -->
    <div class="tips-section">
      <h2 class="tips-title">开始使用</h2>
      <div class="tips-content">
        <div class="tip-item">
          <span class="tip-number">1</span>
          <span class="tip-text">点击左侧图标选择一个AI平台</span>
        </div>
        <div class="tip-item">
          <span class="tip-number">2</span>
          <span class="tip-text">在打开的页面中登录并使用</span>
        </div>
        <div class="tip-item">
          <span class="tip-number">3</span>
          <span class="tip-text">使用快捷键随时唤醒窗口</span>
        </div>
      </div>
    </div>

    <!-- 底部提示 -->
    <div class="footer-section">
      <p class="footer-text">
        窗口关闭后会最小化到系统托盘，右键托盘图标可完全退出应用
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
