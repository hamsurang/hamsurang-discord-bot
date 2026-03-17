# 함수랑 공유봇

## 디스코드 채널의 링크 자동 요약 + 음성 채널 회의 요약 봇

|링크 자동 요약|음성 채널 회의 요약|
|---|---|
|<img width="846" height="1084" alt="image" src="https://github.com/user-attachments/assets/4cfd608d-dbcf-45c6-904c-e3ce62e7b1cf" />|<img width="402" height="1301" alt="image" src="https://github.com/user-attachments/assets/37840e1d-5b97-45b9-a46c-d775df1924b1" />|

## 주간 랭킹

<img width="561" height="878" alt="image" src="https://github.com/user-attachments/assets/28d070ac-787f-4114-bec4-899b78b4b4f6" />



## 사전 요구사항

- **Node.js** >= 22.12.0
- **pnpm** >= 10.x
- **macOS 빌드 도구** (네이티브 모듈 컴파일에 필요)

```bash
# macOS - Xcode Command Line Tools 설치
xcode-select --install
```

> Windows의 경우 `npm install -g windows-build-tools` 필요

## 설치

```bash
git clone <repository-url>
cd hamsurang-discord-bot
pnpm install
```

### 네이티브 모듈 빌드 실패 시

이 프로젝트는 C++ 네이티브 애드온 3개를 사용합니다. `pnpm install`에서 빌드 에러가 나면 아래를 확인하세요.

| 패키지 | 역할 | 실패 시 확인 |
|--------|------|-------------|
| `@discordjs/opus` | Opus 오디오 디코딩 | `xcode-select --install` 후 `pnpm rebuild @discordjs/opus` |
| `sodium-native` | 음성 통신 암호화 | 동일하게 `pnpm rebuild sodium-native` |
| `ffmpeg-static` | FFmpeg 바이너리 (postinstall로 다운로드) | `node node_modules/ffmpeg-static/install.js` 수동 실행 |

전체 재빌드:

```bash
pnpm install --force
```

## 설정

프로젝트 루트에 `config.json` 파일을 생성하세요 (`.gitignore`에 포함되어 있어 직접 만들어야 합니다):

```json
{
  "token": "디스코드 봇 토큰",
  "clientId": "디스코드 앱 Client ID",
  "guildId": "디스코드 서버(길드) ID",
  "geminiApiKey": "Google Gemini API 키",
  "allowedChannelIds": ["링크 요약을 활성화할 채널 ID"],
  "openaiApiKey": "OpenAI API 키 (음성 STT용)"
}
```

### 디스코드 봇 설정 (Developer Portal)

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 앱 생성
2. **Bot** 탭에서 토큰 복사 -> `config.json`의 `token`에 입력
3. **Privileged Gateway Intents** 에서 다음을 활성화:
   - Message Content Intent
   - Server Members Intent (선택)
4. **OAuth2 > URL Generator** 에서 봇 초대 URL 생성:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Create Public Threads`, `Read Message History`, `Connect`, `Speak`, `Add Reactions`

## 실행

```bash
# 슬래시 커맨드 등록 (최초 1회 또는 커맨드 변경 시)
pnpm run deploy

# 개발 모드 실행
pnpm run dev

# 프로덕션 빌드 및 실행
pnpm run build
pnpm run start
```

## 기능

### 링크 자동 요약

설정된 채널에 URL이 포함된 메시지가 올라오면 자동으로 동작합니다. (현재는 #함수랑 공유해 페이지에서만 허용해뒀습니다!)

1. Jina Reader API로 웹페이지 콘텐츠를 마크다운으로 추출 (실패 시 직접 HTML 파싱 fallback, 최대 3회 재시도)
2. YouTube 링크는 자막을 추출하여 별도 처리
3. 커뮤니티 사이트(LinkedIn, X, Reddit 등)는 댓글/반응 포함 요약
4. Gemini API로 요약 + 키워드 생성
5. 원본 메시지에 스레드를 생성하고 임베드로 요약 결과 게시

### 주간 랭킹

`/ranking_weekly` 커맨드로 실행합니다.

- 최근 7일간 URL 포함 메시지 중 리액션 TOP 3
- 최근 7일간 스레드 댓글 수 TOP 3

### 음성 채널 요약

1. `/요약시작` - 봇이 음성 채널에 접속하여 녹음 시작
2. `/요약끝` - 녹음 종료 후 STT(Whisper) -> 요약(Gemini) 결과 게시

## 프로젝트 구조

```
src/
  index.ts                    # 봇 엔트리포인트
  deploy-commands.ts          # 슬래시 커맨드 등록 스크립트
  types.ts                    # 타입 정의
  constants/
    discord.ts                # Discord 관련 상수 (임베드 색상, 스레드명 길이)
    fetcher.ts                # 페이지 fetch 관련 상수 (Jina Reader, 콘텐츠 길이)
    hosts.ts                  # 커뮤니티 사이트 호스트 목록
    prompts.ts                # AI 요약 프롬프트 (일반, 커뮤니티, YouTube)
  lib/
    ai.ts                     # Gemini 클라이언트 초기화 및 호출 래퍼
  utils/
    url.ts                    # URL 정규식, YouTube ID 추출, 커뮤니티 판별
  services/
    pageFetcher.ts            # Jina Reader + 직접 파싱 fallback
    summarizer.ts             # 콘텐츠 요약 (일반/커뮤니티/YouTube)
  events/
    messageCreate.ts          # 링크 감지 → fetch → 요약 → 스레드 게시
  commands/
    utility/
      ranking_weekly.ts       # 주간 랭킹 커맨드
    voice/
      summary_start.ts        # 음성 녹음 시작 커맨드
      summary_end.ts          # 음성 녹음 종료 및 요약 커맨드
  voice/
    recorder.ts               # 음성 수신, Opus 디코딩, PCM 믹싱
    transcriber.ts            # PCM -> WAV 변환 및 Whisper STT
    summarizer.ts             # 텍스트 요약
```
