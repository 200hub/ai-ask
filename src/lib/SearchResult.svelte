<script lang="ts">
  interface Props {
    query: string;
    result: string;
    isLoading: boolean;
    onBack: () => void;
  }
  
  let { query, result, isLoading, onBack }: Props = $props();
</script>

<div class="search-result">
  <div class="header">
    <button class="back-btn" onclick={onBack} aria-label="返回">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="query-display">
      <span class="query-label">搜索:</span>
      <span class="query-text">{query}</span>
    </div>
  </div>
  
  <div class="content">
    {#if isLoading}
      <div class="loading">
        <div class="spinner"></div>
        <p>AI正在思考中...</p>
      </div>
    {:else if result}
      <div class="result-content">
        {@html result}
      </div>
    {:else}
      <div class="empty">
        <p>暂无结果</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .search-result {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  
  .header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
  }
  
  @media (prefers-color-scheme: light) {
    .header {
      border-bottom-color: rgba(0, 0, 0, 0.1);
      background: rgba(0, 0, 0, 0.03);
    }
  }
  
  .back-btn {
    padding: 0.5rem;
    border-radius: 8px;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .back-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  
  .query-display {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  
  .query-label {
    font-weight: 600;
    flex-shrink: 0;
  }
  
  .query-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.8;
  }
  
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 2rem;
  }
  
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 1.5rem;
  }
  
  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid rgba(100, 108, 255, 0.1);
    border-top-color: #646cff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  
  .loading p {
    font-size: 1.1rem;
    opacity: 0.7;
  }
  
  .result-content {
    line-height: 1.8;
  }
  
  .result-content :global(h1),
  .result-content :global(h2),
  .result-content :global(h3) {
    margin-top: 1.5rem;
    margin-bottom: 1rem;
  }
  
  .result-content :global(p) {
    margin-bottom: 1rem;
  }
  
  .result-content :global(ul),
  .result-content :global(ol) {
    margin-bottom: 1rem;
    padding-left: 2rem;
  }
  
  .result-content :global(li) {
    margin-bottom: 0.5rem;
  }
  
  .result-content :global(code) {
    background: rgba(100, 108, 255, 0.1);
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
  }
  
  .result-content :global(pre) {
    background: rgba(0, 0, 0, 0.3);
    padding: 1rem;
    border-radius: 8px;
    overflow-x: auto;
    margin-bottom: 1rem;
  }
  
  @media (prefers-color-scheme: light) {
    .result-content :global(pre) {
      background: rgba(0, 0, 0, 0.05);
    }
  }
  
  .result-content :global(a) {
    color: #646cff;
    text-decoration: none;
  }
  
  .result-content :global(a:hover) {
    text-decoration: underline;
  }
  
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    opacity: 0.5;
  }
</style>
