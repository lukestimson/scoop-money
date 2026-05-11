import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installBrowserMockApi } from './lib/browserMockApi'
import App from './App'
import './assets/main.css'
import { AppProvider } from './context/AppContext'
import { ChatProvider } from './context/ChatContext'
import { DateFormatProvider } from './context/DateFormatContext'
import { ThemeProvider } from './context/ThemeContext'

installBrowserMockApi()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AppProvider>
      <ChatProvider>
        <ThemeProvider>
          <DateFormatProvider>
            <App />
          </DateFormatProvider>
        </ThemeProvider>
      </ChatProvider>
    </AppProvider>
  </StrictMode>
)
