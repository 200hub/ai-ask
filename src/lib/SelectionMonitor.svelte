<script lang="ts">
  import { onMount } from 'svelte';
  import { readText } from '@tauri-apps/plugin-clipboard-manager';
  
  interface Props {
    onSearch: (text: string) => void;
  }
  
  let { onSearch }: Props = $props();
  
  let showButton = $state(false);
  let buttonPosition = $state({ x: 0, y: 0 });
  let selectedText = $state('');
  
  onMount(() => {
    function handleSelection() {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      
      if (text && text.length > 0) {
        selectedText = text;
        
        // Get selection position
        const range = selection?.getRangeAt(0);
        if (range) {
          const rect = range.getBoundingClientRect();
          buttonPosition = {
            x: rect.left + rect.width / 2,
            y: rect.top - 45,
          };
          showButton = true;
        }
      } else {
        showButton = false;
      }
    }
    
    // Handle text selection
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('keyup', handleSelection);
    
    // Handle clicks outside
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('.search-button')) {
        showButton = false;
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    
    // Register global keyboard shortcut (Ctrl/Cmd + Shift + S)
    function handleKeyboard(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        handleSelection();
        if (selectedText) {
          handleSearch();
        }
      }
    }
    
    document.addEventListener('keydown', handleKeyboard);
    
    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('keyup', handleSelection);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyboard);
    };
  });
  
  function handleSearch() {
    if (selectedText) {
      onSearch(selectedText);
      showButton = false;
    }
  }
</script>

{#if showButton}
  <button
    class="search-button"
    style="left: {buttonPosition.x}px; top: {buttonPosition.y}px;"
    onclick={handleSearch}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="8" stroke="white" stroke-width="2"/>
      <path d="M21 21L16.65 16.65" stroke="white" stroke-width="2" stroke-linecap="round"/>
    </svg>
    AI搜索
  </button>
{/if}

<style>
  .search-button {
    position: fixed;
    transform: translateX(-50%);
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    background: linear-gradient(135deg, #646cff 0%, #535bf2 100%);
    color: white;
    border: none;
    border-radius: 20px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(100, 108, 255, 0.4);
    transition: all 0.2s;
    animation: slideIn 0.2s ease-out;
  }
  
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
  
  .search-button:hover {
    transform: translateX(-50%) translateY(-2px);
    box-shadow: 0 6px 16px rgba(100, 108, 255, 0.5);
  }
  
  .search-button:active {
    transform: translateX(-50%) translateY(0);
  }
</style>
