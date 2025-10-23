<script lang="ts">
  interface Props {
    currentModel: string;
    onModelChange: (model: string) => void;
    onClose: () => void;
  }
  
  let { currentModel, onModelChange, onClose }: Props = $props();
  
  const models = [
    { id: 'chatgpt', name: 'ChatGPT', description: 'OpenAI的对话模型，支持网页搜索' },
    { id: 'claude', name: 'Claude', description: 'Anthropic的Claude助手' },
    { id: 'gemini', name: 'Gemini', description: 'Google的AI助手' },
    { id: 'perplexity', name: 'Perplexity', description: '专注于搜索的AI引擎' },
  ];
  
  let selectedModel = $state(currentModel);
  
  function handleSave() {
    onModelChange(selectedModel);
    onClose();
  }
</script>

<div class="config-panel">
  <div class="header">
    <h2>配置设置</h2>
    <button class="close-btn" onclick={onClose} aria-label="关闭">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
  
  <div class="content">
    <section>
      <h3>选择AI模型</h3>
      <p class="section-description">选择您想要使用的AI模型进行搜索</p>
      
      <div class="model-list">
        {#each models as model}
          <label class="model-item" class:selected={selectedModel === model.id}>
            <input
              type="radio"
              name="model"
              value={model.id}
              bind:group={selectedModel}
            />
            <div class="model-info">
              <div class="model-name">{model.name}</div>
              <div class="model-description">{model.description}</div>
            </div>
            <div class="radio-indicator"></div>
          </label>
        {/each}
      </div>
    </section>
    
    <div class="info-box">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
        <path d="M12 16V12M12 8H12.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p>本应用仅使用免费的网页搜索功能，不会产生API费用。选中文本后，系统会自动显示"AI搜索"按钮。</p>
    </div>
  </div>
  
  <div class="footer">
    <button class="cancel-btn" onclick={onClose}>取消</button>
    <button class="save-btn" onclick={handleSave}>保存</button>
  </div>
</div>

<style>
  .config-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--background);
  }
  
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem 2rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  @media (prefers-color-scheme: light) {
    .header {
      border-bottom-color: rgba(0, 0, 0, 0.1);
    }
  }
  
  h2 {
    font-size: 1.5rem;
    font-weight: 600;
  }
  
  .close-btn {
    padding: 0.5rem;
    border-radius: 50%;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 2rem;
  }
  
  section {
    margin-bottom: 2rem;
  }
  
  h3 {
    font-size: 1.2rem;
    margin-bottom: 0.5rem;
  }
  
  .section-description {
    opacity: 0.7;
    margin-bottom: 1.5rem;
  }
  
  .model-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .model-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.2rem;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  @media (prefers-color-scheme: light) {
    .model-item {
      border-color: rgba(0, 0, 0, 0.1);
    }
  }
  
  .model-item:hover {
    border-color: #646cff;
    transform: translateY(-2px);
  }
  
  .model-item.selected {
    border-color: #646cff;
    background: rgba(100, 108, 255, 0.1);
  }
  
  .model-item input[type="radio"] {
    display: none;
  }
  
  .model-info {
    flex: 1;
  }
  
  .model-name {
    font-weight: 600;
    margin-bottom: 0.3rem;
  }
  
  .model-description {
    font-size: 0.9rem;
    opacity: 0.7;
  }
  
  .radio-indicator {
    width: 20px;
    height: 20px;
    border: 2px solid currentColor;
    border-radius: 50%;
    position: relative;
  }
  
  .model-item.selected .radio-indicator::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 10px;
    height: 10px;
    background: #646cff;
    border-radius: 50%;
  }
  
  .info-box {
    display: flex;
    gap: 1rem;
    padding: 1rem 1.5rem;
    background: rgba(100, 108, 255, 0.1);
    border-radius: 12px;
    border-left: 4px solid #646cff;
  }
  
  .info-box svg {
    flex-shrink: 0;
    margin-top: 0.1rem;
  }
  
  .info-box p {
    font-size: 0.9rem;
    line-height: 1.5;
    opacity: 0.9;
  }
  
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    padding: 1.5rem 2rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  @media (prefers-color-scheme: light) {
    .footer {
      border-top-color: rgba(0, 0, 0, 0.1);
    }
  }
  
  .cancel-btn,
  .save-btn {
    padding: 0.7rem 1.5rem;
  }
  
  .cancel-btn {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  
  @media (prefers-color-scheme: light) {
    .cancel-btn {
      border-color: rgba(0, 0, 0, 0.2);
    }
  }
  
  .save-btn {
    background: #646cff;
    color: white;
  }
  
  .save-btn:hover {
    background: #535bf2;
  }
</style>
