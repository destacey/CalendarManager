import React, { createContext, useContext, ReactNode } from 'react'
import { message } from 'antd'

interface MessageContextType {
  success: (content: string) => void
  error: (content: string) => void
  warning: (content: string) => void
  info: (content: string) => void
  loading: (content: string) => () => void
}

const MessageContext = createContext<MessageContextType | null>(null)

interface MessageProviderProps {
  children: ReactNode
}

export const MessageProvider: React.FC<MessageProviderProps> = ({ children }) => {
  const [messageApi, contextHolder] = message.useMessage()

  const messageContextValue: MessageContextType = {
    success: (content: string) => messageApi.success(content),
    error: (content: string) => messageApi.error(content),
    warning: (content: string) => messageApi.warning(content),
    info: (content: string) => messageApi.info(content),
    loading: (content: string) => messageApi.loading(content),
  }

  return (
    <MessageContext.Provider value={messageContextValue}>
      {contextHolder}
      {children}
    </MessageContext.Provider>
  )
}

export const useMessage = (): MessageContextType => {
  const context = useContext(MessageContext)
  if (!context) {
    throw new Error('useMessage must be used within a MessageProvider')
  }
  return context
}