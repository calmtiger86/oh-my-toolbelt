<p align="center">
  <a href="README.md">English</a> · <b>한국어</b> · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img src="assets/logo.svg" width="112" alt="Oh My Toolbelt 로고">
</p>

<h1 align="center">Oh My Toolbelt</h1>

<p align="center">
  <b>터미널이 낯설어도, Claude Code를 편하게.</b><br>
  자주 쓰는 프롬프트는 버튼으로, 파일 첨부는 선택 창으로, 떠오른 생각은 메모로. 입력창 바로 위 툴벨트 한 줄에 다 있습니다.
</p>

Claude Code를 터미널에서 쓰다 보면 낯선 화면과 부족한 편의 기능 때문에 당황할 때가 많습니다. Oh My Toolbelt는 비개발자가 터미널을 쓰며 불편했던 것들을 모아 만든 툴벨트입니다.

입력창 위에 툴벨트 한 줄만 더하면 자주 쓰는 명령어와 프롬프트를 버튼으로 만들어 둘 수 있습니다. 번거롭던 파일 첨부는 경로를 칠 필요 없이 선택 창에서 고르면 됩니다. 작업 중에 떠오른 아이디어는 메모에 적어 두었다가 바로 입력창으로 가져옵니다. 예전에 보낸 프롬프트도 목록에서 눌러 바로 찾아갈 수 있습니다. 자리를 비울 때는 **가리기**로 작업 내용을 덮고, 세션의 대화 기록은 **내보내기**로 한 번에 파일로 남길 수 있습니다.

터미널을 처음 쓸 때 겪었던 불편을 툴벨트 하나로 줄였습니다. 데스크탑 앱에서도 대부분 그대로 사용할 수 있습니다.

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-d77757"></a>
  <img alt="Claude Code 2.1.309 이상" src="https://img.shields.io/badge/Claude%20Code-2.1.309%2B-1f1f22">
  <img alt="터미널과 데스크탑 앱" src="https://img.shields.io/badge/runs%20in-terminal%20%7C%20desktop%20app-555">
  <img alt="영어, 한국어, 일본어" src="https://img.shields.io/badge/languages-en%20%7C%20ko%20%7C%20ja-555">
</p>

![Claude Code 대화 아래의 툴벨트: 왼쪽에 시계, 날짜, 날씨, 진행 중인 뽀모도로, 오른쪽에 프롬프트 버튼과 첨부, 음성, 밝게, 가리기, 내보내기, 메모, 편집 버튼](assets/screenshot-toolbelt.png)

**터미널에서:**

```sh
claude plugin install oh-my-toolbelt --marketplace calmtiger86/oh-my-toolbelt
```

한 줄로 설치합니다. Claude Code가 이미 열려 있다면 그 안에서 `/reload-plugins`를 입력하세요. 바로 켜집니다. 설치 끝에 `userConfig options not yet set` 안내가 나와도 괜찮습니다. 모든 설정이 기본값으로 시작합니다. 날씨 도시를 고르기 전에는 인터넷에 접속하지 않고, 클립보드 기록은 켜기 전까지 모으지 않으며, 툴벨트에 적은 내용은 내가 프롬프트로 보내지 않는 한 컴퓨터 밖으로 나가지 않습니다.

**데스크탑 앱에서:** **+** → **플러그인** → **플러그인 탐색** → **추가** → **마켓플레이스 추가** → **저장소에서 추가**를 고르고 `calmtiger86/oh-my-toolbelt`를 넣습니다. 그다음 목록에서 oh-my-toolbelt를 골라 설치합니다. 위의 터미널 명령을 한 번 실행해도 됩니다. 터미널과 데스크탑 앱의 로컬 세션은 같은 설정을 읽습니다.

<details>
<summary><b>설치 자세히: 요구 사항, 업데이트와 삭제</b></summary>

**필요한 것:** Claude Code 2.1.309 이상, 터미널 또는 데스크탑 앱의 Code 탭. VS Code와 모바일은 입력창 위 줄을 그리지 않습니다.

터미널에서:

```sh
claude plugin install oh-my-toolbelt --marketplace calmtiger86/oh-my-toolbelt
```

Claude Code 안에서:

```
/plugin install oh-my-toolbelt --marketplace calmtiger86/oh-my-toolbelt
```

마켓플레이스를 추가할지 물으면 `y`, 범위는 Enter를 누릅니다. 이어서 설정 화면이 나오면 줄마다 Enter로 기본값을 두고 Save를 누릅니다.

업데이트는 `claude plugin update oh-my-toolbelt` 뒤 Claude Code를 다시 시작하면 되고(바뀐 내용은 [CHANGELOG.md](CHANGELOG.md), 영어), 지우려면 `claude plugin uninstall oh-my-toolbelt`를 입력합니다.

</details>

## 기능

| 기능 | 하는 일 |
|---|---|
| **내 버튼** | 자주 쓰는 프롬프트와 명령을 버튼으로 저장합니다. 누르면 입력창에 넣거나 바로 보냅니다 |
| **프롬프트 목록** | 보낸 프롬프트가 번호와 함께 쌓이고, 누르면 그 자리로 갑니다 |
| **첨부** | 파일 선택 창에서 고르면 입력창에 `@` 멘션으로 들어갑니다(터미널) |
| **메모** | 떠오른 생각을 적어 두었다가 입력창에 넣습니다. 모든 세션이 같은 메모를 씁니다 |
| **클립보드 기록** | 대화에서 복사한 글을 모아 두었다가 다시 넣습니다(기본 꺼짐. 데스크탑 앱과 터미널 전체 화면 방식에서만) |
| **가리기** | 한 번 누르면 대화를 덮습니다 |
| **내보내기** | 대화를 Markdown, HTML, 텍스트 파일로 저장합니다. 터미널에서는 **상태** 탭의 **PDF 브라우저**에서 Chromium 계열 브라우저를 고르고 **내보내기 형식**을 PDF로 바꾸면 PDF도 만듭니다 |
| **시계 · 날짜 · 날씨** | 시계와 날짜가 늘 보이고, 도시를 고르면 날씨도 보입니다(날씨는 기본 꺼짐) |
| **뽀모도로** | 집중 시간을 진행 막대로 보여 주고, 끝나면 알려 줍니다 |
| **음성** | Claude Code의 음성 입력을 켜고 끕니다(터미널) |
| **밝게 / 어둡게** | 화면 테마를 바꿉니다 |
| **접기** | `◂`를 누르면 툴벨트 전체가 `▸` 하나로 접힙니다 |
| **패널** | **편집** 버튼이나 `/toolbelt`로 엽니다. 설정, 버튼 배치, 단계별 가이드가 들어 있습니다 |

## 빠르게 시작하기

1. 대화 아래, 입력창 바로 위의 줄이 툴벨트입니다.
2. **편집**을 누르고 **가이드** 탭의 1번을 따라 해 보세요. 2분이면 됩니다.
3. **상태** 탭에서 내게 맞게 바꿉니다. 날씨 도시를 고르고, **클립보드 탭**을 켜고, 12시간이나 24시간을 고릅니다.

![패널의 프롬프트, 메모, 클립보드, 상태 탭](assets/screenshot-panel.png)

## 자세히 보기

**처음이라면 가이드부터 보세요.** 툴벨트에서 **편집**을 누르고 **가이드** 탭을 열면, 기능마다 무엇을 누르면 되는지 단계별로 알려 줍니다. 가이드는 설정한 언어(한국어, 영어, 일본어)로 나옵니다.

<details>
<summary><b>툴벨트와 패널 자세히</b></summary>

### 툴벨트

왼쪽에는 정보, 오른쪽에는 버튼이 있습니다. 창이 좁으면 버튼이 아이콘만 남기고 줄어들며, 덜 쓰는 것은 `…` 안으로 들어갑니다.

| 도구 | 하는 일 |
|---|---|
| `◂` / `▸` | 툴벨트를 `▸` 하나로 접고, 다시 펼칩니다. 접어 둔 상태는 다음에도 그대로입니다 |
| 시계 · 날짜 | 12시간 또는 24시간, 컴퓨터 시간대나 UTC나 53개 도시의 시간대 중 선택, 원하면 초까지. 날짜는 언어에 맞는 순서로 보입니다 |
| 날씨 | 63개 도시 중 하나를 고르기 전에는 꺼져 있습니다. 지금 날씨를 보여 주고, 기본으로 30분마다 새로 받습니다 |
| 뽀모도로 | 누르면 집중이 시작되고, 다시 누르면 잠시 멈추고, 한 번 더 누르면 이어집니다. 휴식은 휴식 자동 시작을 켰을 때만 잽니다. 한 회가 끝나면 알림이 오고, 켜면 macOS에서 소리도 납니다 |
| 내 버튼 | 저장한 프롬프트를 입력창에 넣거나 보내고, 슬래시 명령이나 스킬을 실행합니다. 세트로 묶어 바꿔 쓸 수 있습니다 |
| 첨부 | 운영체제의 파일 선택 창을 열고, 고른 파일을 입력창에 `@` 멘션으로 넣습니다(터미널) |
| 음성 | Claude Code의 음성 입력을 켜고 끕니다. `/voice`가 있는 Claude Code에서 보입니다(터미널) |
| 밝게 / 어둡게 | Claude Code 테마를 밝은 쪽과 어두운 쪽으로 바꿉니다 |
| 가리기 | 다시 누를 때까지 대화를 덮습니다 |
| 내보내기 | 상태 탭에서 고른 형식으로 대화를 저장합니다(처음에는 Markdown) |
| 메모 | 메모를 엽니다 |
| 편집 | 패널을 엽니다 |

### 패널

**편집**을 누르거나 `/toolbelt`를 입력하면 대화 옆에 패널이 열립니다.

| 탭 | 들어 있는 것 |
|---|---|
| 프롬프트 | 이 대화에서 보낸 프롬프트가 번호와 함께 모두 있습니다(최근 200개). 누르면 그 프롬프트로 이동합니다. 마우스를 올리면 툴벨트 줄에 그 차례의 정보(걸린 시간, 쓴 도구, 고친 파일)가 나옵니다. 데스크탑 앱에서는 그 자리에서 펼쳐져, 답을 끝까지 읽거나, 그 프롬프트를 입력창에 다시 넣거나, 그 답만 내보낼 수 있습니다 |
| 메모 | 모든 세션이 함께 쓰는 메모장입니다. 넣기를 누르면 입력창 커서 자리에 들어갑니다. 메모는 500개(256 KiB)까지 두고, 넘으면 가장 오래된 것부터 지웁니다 |
| 클립보드 | 처음에는 꺼져 있습니다. 대화에서 드래그해 복사한 글이 최근 것부터 쌓이고(최근 30개, 2만 자가 넘는 선택은 모으지 않음), 넣기로 다시 넣습니다. Claude Code를 닫을 때까지 메모리에만 있고 파일에는 쓰지 않습니다 |
| 상태 | 이번 세션의 요약(버전, 날씨, 끝낸 집중 횟수, 마지막 오류), 모든 도구, 그리고 모든 설정이 스위치와 목록으로 있습니다 |
| 도구 | 배치(왼쪽·오른쪽, 순서, 보이기·숨기기), 내 버튼과 버튼 세트, 아이콘을 고칩니다 |
| 가이드 | 위의 모든 것을 차례대로 안내합니다. 언어 설정을 따릅니다 |

</details>

<details>
<summary><b>명령과 단축키</b></summary>

터미널에서는 `ctrl+x`를 눌렀다 떼고 `tab`을 누르면 툴벨트가 선택됩니다. Tab으로 버튼을 옮겨 다니고, Enter로 누르고, Esc로 입력창에 돌아갑니다. 선택된 동안에는 글자 하나로 도구를 누를 수 있습니다(`a` 첨부, `v` 음성, `t` 밝게·어둡게, `h` 가리기, `e` 내보내기, `n` 메모, `b` 편집, `m` 더 보기). 내 버튼에도 글자를 줄 수 있습니다. 데스크탑 앱에서는 버튼을 마우스로 누릅니다.

| 명령어 | 하는 일 |
|---|---|
| `/toolbelt` (다른 mod가 쓰지 않으면 `/tb`도) | 패널을 엽니다 |
| `/toolbelt tools` · `toc` · `notes` · `clips` · `status` · `guide` | 그 탭으로 패널을 엽니다 |
| `/toolbelt toc next` · `prev` · `first` · `last` · `<번호>` · `find <단어>` | 프롬프트로 이동합니다 |
| `/toolbelt pomodoro start` · `pause` · `stop` · `reset` | 시작·이어가기, 일시정지, 끝내기(끝낸 횟수는 남음), 초기화(끝낸 횟수도 0으로) |
| `/toolbelt export [md\|html\|txt\|pdf]` | 대화를 내보냅니다 |
| `/toolbelt curtain on` · `off` | 대화를 가리거나 다시 보입니다 |
| `/toolbelt weather refresh` | 날씨를 지금 다시 받습니다 |
| `/toolbelt hide` · `show` | 툴벨트를 완전히 숨기거나 다시 보입니다 |

</details>

<details>
<summary><b>설정</b></summary>

모든 설정은 스위치나 목록입니다. 패널의 **상태** 탭에서 바꾸고, 내보내기 형식을 뺀 나머지는 `/config`에서도 바꿀 수 있습니다.

| 설정 | 기본값 | 선택지 |
|---|---|---|
| `language` | `auto` | `auto`(시스템 언어), `en`, `ko`, `ja` |
| `clockFormat` · `clockSeconds` | `auto` · 끔 | `auto`, `12`, `24`; 초 표시 켜기·끄기 |
| `dateFormat` | `auto` | `off`, `auto`, 연도 먼저, 일 먼저, 월 먼저 |
| `timeZone` | `system` | 컴퓨터 시간대, `UTC`, 53개 도시 중 하나 |
| `iconStyle` | `icon+label` | `icon+label`, `icon`, `label`(이모지가 깨지는 터미널용) |
| `weatherPlace` | `off` | `off` 또는 63개 도시 중 하나 |
| `temperatureUnit` · `weatherRefreshMinutes` | `auto` · `30` | `auto`(미국 도시는 화씨), 섭씨 또는 화씨; 10~180분 |
| `pomodoroFocusMinutes` · `pomodoroBreakMinutes` | `25` · `5` | 5~120; 1~60 |
| `pomodoroAutoBreak` · `pomodoroNotify` | 끔 · 켬 | 집중이 끝나면 휴식을 바로 시작(꺼져 있으면 휴식을 재지 않음); 한 회가 끝나면 알림 |
| `pomodoroSound` · `pomodoroSoundName` | 끔 · `bell` | 끝날 때 소리(macOS): `bell`, `chime`, `ding`, `digital`, `marimba`, `soft` |
| `exportDirectory` · `pdfBrowser` | `downloads` · `off` | 내보낼 폴더(`downloads`, `desktop`, `documents`, `home`, 또는 `session`: 프로젝트 폴더라 파일이 git에 들어갈 수 있음); PDF를 인쇄할 브라우저(`auto`, `chrome`, `edge`, `brave`, `chromium`) |
| 내보내기 형식(상태 탭에만 있음) | `md` | `md`, `html`, `txt`, 그리고 `pdfBrowser`를 정하면 터미널에서 `pdf` |
| `attachEnabled` · `voiceMode` | 켬 · `tap` | 첨부 버튼; 음성 녹음 방식(`tap` 또는 `hold`) |
| `curtainRestoreOnSubmit` | 끔 | 프롬프트를 보내면 가린 대화를 다시 보입니다 |
| `hotkeysEnabled` | 켬 | 툴벨트 버튼의 글자 단축키 |
| `tocTab` · `clipboardTab` | 켬 · 끔 | 프롬프트 탭; 클립보드 탭 |
| `paneOpenOnStart` | 끔 | 세션을 시작할 때 패널을 엽니다(넓은 창) |

</details>

**개인정보:** Oh My Toolbelt는 내 컴퓨터에서 동작하고, 만든 사람에게 나에 관한 어떤 것도 보내지 않습니다. 인터넷 요청은 날씨를 켰을 때 날씨를 받는 것 하나뿐입니다.

<details>
<summary><b>개인정보 자세히</b></summary>

- **네트워크:** 날씨뿐이고, 도시를 고른 뒤에만 씁니다. `api.open-meteo.com`은 그 도시의 좌표와 온도 단위를 받고, 다른 웹 요청과 마찬가지로 내 IP 주소도 봅니다.
- **대화 내용:** 프롬프트 탭이 켜져 있으면(기본값) 프롬프트 목록을 만들려고 내가 보내는 프롬프트, 차례마다 한 일(도구 이름, 고친 파일, 걸린 시간), 이 세션의 대화 기록 파일을 읽습니다. 내보내기는 내가 요청한 파일에 대화를 씁니다. 내가 친 명령은 남기고, 그 명령의 출력과 Claude Code가 프롬프트 앞에 덧붙인 숨은 글은 넣지 않습니다. 둘 다 컴퓨터 밖으로 나가지 않습니다.
- **이 컴퓨터에 저장하는 것:** 버튼, 배치, 아이콘, 메모, 뽀모도로, 날씨 캐시, 몇 가지 선택값, 그리고 프롬프트 탭이 켜져 있는 동안(기본 켜짐) 기록한 최근 세션 20개의 대화 기록 파일 경로입니다. Claude Code의 플러그인 저장소에 평문으로 둡니다. 클립보드 기록은 메모리에만 있습니다. Claude Code가 켜져 있는 동안에는 내가 설치한 다른 mod도 메모, 버튼, 클립보드 기록을 읽을 수 있습니다.
- **실행하는 프로그램:** 첨부를 누를 때 파일 선택 창, PDF로 내보낼 때 브라우저. 그리고 프롬프트 탭이 켜져 있으면, 이 세션의 대화 기록이 4 MiB를 넘을 때 그것을 읽으려고 저절로 `tail`(Windows는 PowerShell)을 실행합니다. 모두 셸 없이 인자 목록으로 실행합니다.
- **모델**은 내가 고른 것만 봅니다. 누른 프롬프트 버튼, 그리고 입력창에 넣은 메모, 클립, 이전 프롬프트, 첨부한 파일뿐입니다. `/toolbelt` 명령의 한 줄 답은 대화에 남아 모델이 읽을 수 있습니다.

자세한 내용은 [PRIVACY.md](PRIVACY.md)(영어)에 있습니다.

</details>

<details>
<summary><b>한계</b></summary>

- **데스크탑 앱:** 첨부와 음성 버튼이 없고(앱 입력창에 이미 있음), PDF 내보내기가 없으며, 뽀모도로 알림은 앱 안의 메시지로 옵니다. Claude Code가 그곳에서는 mod에게 대화 스크롤을 허락하지 않아서, 프롬프트를 누르면 이동하는 대신 그 자리에서 펼쳐집니다. 상태 탭에서 바꾼 설정은 바로 적용되고 툴벨트가 따로 저장해 두었다가, 다음에 터미널에서 쓸 때 `/config`로 옮깁니다.
- **클립보드 탭:** 데스크탑 앱과, Claude Code가 터미널 화면 전체를 그리는 방식(`"tui": "fullscreen"`)에서 모읍니다. inline 방식에서는 글 선택을 터미널 앱이 맡아서 툴벨트에 아무것도 오지 않습니다.
- **가리기**는 대화를 덮지만, 로고나 안내처럼 Claude Code가 직접 그리는 줄은 남습니다.
- **가리기와 내 버튼:** `curtainRestoreOnSubmit`이 꺼져 있으면 동작이 보내기인 내 버튼으로 보낸 프롬프트는 가려지지 않습니다(답은 가려짐). Claude Code는 mod가 보낸 프롬프트의 줄을 그 mod에는 넘기지 않기 때문입니다.
- **내보내기:** Claude Code의 태그 모양(`<command-name>`, `<bash-stdout>` 등)으로 시작하는 글은 Claude Code의 출력과 구별할 수 없어서 내보내기에서 빠질 수 있습니다.
- **프롬프트 탭:** 프롬프트에 보여 주는 차례 정보에는 그 프롬프트가 시작한 차례만 셉니다. `!` 셸 명령(bash 모드)의 답, 내 조작에 이어 Claude Code가 스스로 시작하는 차례, 다른 mod, 명령·스킬을 실행하는 내 버튼, 작업 알림이 시작한 차례는 어느 프롬프트에도 세지 않습니다. 차례 길이 기록이 없는 옛 대화에서는 이런 차례도 앞 프롬프트에 더해질 수 있습니다.
- **시험 환경:** macOS의 Claude Code 2.1.309와 2.1.310에서 터미널과 데스크탑 앱으로 직접 확인했습니다. 자동 테스트는 Linux와 Windows에서도 돌지만, 그곳의 파일 선택 창은 손으로 확인하지 않았습니다.

</details>

<details>
<summary><b>문제 해결</b></summary>

- **툴벨트가 안 보이나요?** `/plugin`을 실행해 oh-my-toolbelt가 켜져 있는지 확인하세요. 창이 좁으면 툴벨트가 줄어들고, 14칸쯤보다 좁으면 그리지 않습니다.
- **무언가 실패했나요?** 패널의 **상태** 탭이 마지막 오류를 쉬운 말로 보여 줍니다. 전체 기록은 `claude --debug`로 Claude Code를 실행하면 볼 수 있습니다.
- **이모지가 깨져 보이나요?** `iconStyle`을 `label`로 바꾸세요.
- **`[-]`를 누른 뒤 툴벨트가 사라졌나요?** 터미널에서 Claude Code가 직접 접은 것입니다. 남은 한 줄을 누르거나 `ctrl+x` 다음 `ctrl+a`를 누르세요.
- **`ctrl+x` 다음 Tab이 안 되나요?** 터미널 앱이 그 키를 먼저 쓰고 있을 수 있습니다. `~/.claude/keybindings.json`에서 다른 키를 정하세요. 붙여 넣을 내용은 **가이드** 탭 5번에 있습니다.

</details>

## 개발자를 위해

Oh My Toolbelt는 Claude Code의 **mod**입니다. TypeScript(화면 그리기는 JSX)로 쓴 훅 모듈이고, 엔진이 빌드 없이 그대로 불러옵니다.

```sh
git clone https://github.com/calmtiger86/oh-my-toolbelt
cd oh-my-toolbelt
claude --plugin-dir .          # 실행합니다. 고친 내용은 한 차례가 끝날 때 다시 불러옵니다
claude plugin validate .       # 엔진이 하는 검사
claude plugin test .           # 500개가 넘는 테스트(터미널과 데스크탑 화면 모두)
npx -p typescript@5 tsc -p .   # 타입 검사. Claude Code가 mod를 한 번 불러와 타입을 써 둔 뒤에 됩니다
```

- **구조:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)(영어) 한 장에 모듈, 상태, 저장소, 엔진이 mod에 요구하는 규칙을 정리했습니다.
- **언어 추가:** `hooks/locales/en.ts`를 `hooks/locales/<코드>.ts`로 복사해 번역하고, `hooks/lib/i18n.ts`와 `tests/i18n.test.ts`에 등록한 뒤, `.claude-plugin/plugin.json`의 `language` 선택지에 코드를 더합니다. 테스트가 모든 키와 자리표시자가 있는지 확인합니다. 일본어는 아직 원어민 검토를 받지 못했으니, 고칠 곳을 알려 주시면 반갑겠습니다.
- **도구 추가:** 도구는 `hooks/tools/registry.ts`의 객체입니다(이름, 우선순위, 눌렀을 때 할 일을 효과 목록으로). 효과가 엔진 호출로 바뀌는 곳은 `hooks/register.tsx` 한 곳뿐입니다.
- **기여:** 이슈와 풀 리퀘스트를 환영합니다. 코드, 주석, 커밋 메시지는 영어로 쓰고, 풀 리퀘스트 전에 위의 세 검사를 돌려 주세요. CI는 macOS, Linux, Windows에서 validate와 테스트를 돌립니다.

## 라이선스

[Apache License 2.0](LICENSE). Copyright 2026 calmtiger86 and contributors. 이 코드나 이를 바탕으로 만든 것을 나눌 때는 [NOTICE](NOTICE) 파일을 함께 두고, 고친 파일에 고쳤다는 표시를 남겨 주세요.

프롬프트 탭은 [oikon48/prompt-rail](https://github.com/oikon48/prompt-rail)(MIT)의 코드를 고쳐 썼고, 그 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다. 시계, 날짜, 날씨, 뽀모도로의 칩 모양은 [augiefra/claude-mods](https://github.com/augiefra/claude-mods)를 따랐습니다.

Oh My Toolbelt는 개인 개발자가 만든 비공식 mod이며, Anthropic과 관계가 없고 Anthropic의 보증을 받지 않았습니다. Claude와 Claude Code는 Anthropic, PBC의 상표입니다.
