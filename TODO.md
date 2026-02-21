# AI Assistant - Feature Roadmap

## Overview

This document tracks all planned features for the AI Assistant PWA, organized by category and priority.

---

## Core Enhancements (Issues)

These are focused, single-scope improvements to the existing app experience.

### 1. Session Search

- **Priority**: High
- **Description**: Add a search bar in the session drawer to search across all past conversations by keyword. Helps users quickly find previous discussions without scrolling through session lists.

### 2. Message Bookmarking / Starring

- **Priority**: Medium
- **Description**: Allow users to star or bookmark important AI responses within a conversation. Bookmarked messages can be accessed from a dedicated "Saved" section for quick reference.

### 3. Export Chat

- **Priority**: Medium
- **Description**: Enable users to copy or download an entire conversation as plain text or markdown. Useful for saving or sharing conversations outside the app.

### 4. Session Renaming

- **Priority**: High
- **Description**: Allow users to manually edit a session's title instead of relying solely on the auto-generated title. A long-press or edit icon on the session item triggers inline editing.

### 5. Suggested Prompts

- **Priority**: High
- **Description**: Display quick-start prompt suggestions on the empty state screen when no messages exist. Tapping a suggestion immediately sends it as a message to kick off a conversation.

### 6. Typing Indicators & Better Loading States

- **Priority**: Medium
- **Description**: Show a polished animated "thinking" indicator while the AI is generating a response. Replace the current loading state with a more engaging visual (e.g., animated dots, shimmer effect).

### 7. Message Editing & Regeneration

- **Priority**: Medium
- **Description**: Allow users to edit a previously sent message and regenerate the AI's response from that point. The old response is replaced with a new one based on the edited message.

### 8. Conversation Summary

- **Priority**: Low
- **Description**: Auto-generate a brief summary of each session that appears as a subtitle in the session list. Gives users a quick preview of what each conversation was about.

### 9. Multi-Language Support

- **Priority**: Medium
- **Description**: Auto-detect the user's language and have the AI respond in the same language. Optionally, allow users to translate any message to another language with a tap.

### 10. Conversation Personas / Modes

- **Priority**: Medium
- **Description**: Let users switch between different AI personality modes (e.g., "Creative Writer," "Code Helper," "Fitness Coach," "Tutor"). Each persona adjusts the AI's system prompt and behavior.

### 11. Markdown & Code Rendering

- **Priority**: High
- **Description**: Render AI responses with full markdown support — syntax-highlighted code blocks, tables, lists, bold/italic text, and inline code. Makes technical and structured responses much more readable.

### 12. Message Reactions & Feedback

- **Priority**: Low
- **Description**: Add thumbs up/down buttons on AI responses to let users rate quality. Feedback data can be stored to track which responses were helpful and potentially improve future interactions.

---

## Advanced Capabilities (Initiatives)

These are larger, multi-step features that give the application entirely new capabilities.

### 13. Image Generation in Chat

- **Priority**: High
- **Description**: Allow users to ask the AI to generate images directly in the conversation using DALL-E or a similar model. Generated images appear inline in chat bubbles with options to download or share.
- **Scope**: Backend integration with image generation API, new message type for images, frontend rendering of inline images, download/share functionality.

### 14. File / Image Upload & Analysis

- **Priority**: High
- **Description**: Enable users to attach photos, PDFs, or other documents to their messages. The AI can then analyze images (using vision models), extract text from documents, and answer questions about uploaded content.
- **Scope**: File upload UI, backend file processing pipeline, integration with vision/document models, new message types for attachments, storage for uploaded files.

### 15. Web Search Integration

- **Priority**: High
- **Description**: Give the AI the ability to search the internet in real-time when it needs up-to-date information. The AI decides when to search, retrieves results, and incorporates them into its response with source citations.
- **Scope**: Search API integration, tool-calling mechanism for the AI, citation rendering in the frontend, search result caching.

### 16. Text-to-Speech (TTS) Responses

- **Priority**: Medium
- **Description**: Have the AI read its responses aloud using natural-sounding voices (via OpenAI TTS or similar). Users can tap a speaker icon on any message to hear it spoken, or enable auto-play for all responses.
- **Scope**: TTS API integration, audio player component, per-message and global playback controls, voice selection settings.

### 17. Daily Briefing / Scheduled Summaries

- **Priority**: Low
- **Description**: The AI proactively prepares a daily summary (news, weather, reminders, calendar items) that's ready when the user opens the app. Can be configured to include custom topics of interest.
- **Scope**: Scheduled job system, external API integrations (weather, news), user preferences/settings page, notification system, briefing card UI.

### 18. Smart Reminders & Tasks

- **Priority**: Medium
- **Description**: Let users tell the AI to "remind me to..." or "add a task..." and have it create actionable reminders with due dates. Includes a notification system and a task management view.
- **Scope**: Natural language parsing for reminder/task extraction, new database tables for tasks/reminders, notification system (push notifications via service worker), task management UI, scheduling system.

---

## Status Legend

- [ ] Not started
- [ ] In progress
- [ ] Completed

## Current Status

- [x] Session Search
- [x] Message Bookmarking / Starring
- [x] Export Chat
- [x] Session Renaming
- [x] Suggested Prompts
- [x] Typing Indicators & Better Loading States
- [x] Message Editing & Regeneration
- [x] Conversation Summary
- [x] Multi-Language Support
- [x] Conversation Personas / Modes
- [x] Markdown & Code Rendering
- [x] Message Reactions & Feedback
- [x] Image Generation in Chat
- [x] File / Image Upload & Analysis
- [x] Web Search Integration
- [x] Text-to-Speech (TTS) Responses
- [x] Daily Briefing / Scheduled Summaries
- [x] Smart Reminders & Tasks
