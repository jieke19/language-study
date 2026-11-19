# 언어 학습 일지 (Language Study Log)

영어·중국어 학습 일지를 Google Sheets와 실시간으로 연동해 복습용으로 보여 주는 정적 웹앱입니다. 빌드 과정 없는 순수 HTML/CSS/JS이고, 데이터는 모두 Google Sheets에 있습니다.

- 웹앱: <https://jieke19.github.io/language-study/>
- 원본 시트: [중국어 학습 일지 (HSK4 회화)](https://docs.google.com/spreadsheets/d/1xLU9z-efrT0T6C9wYCHAOtofFGXlzBQTKIMRmuJLgi8/edit) · [영어 학습 일지 (프리토킹)](https://docs.google.com/spreadsheets/d/1po1nVbKdk8fy8WB4mgnqspdYP9VnB7E0SNYIahqocqs/edit)

## 목표

| 언어 | 목표 |
| --- | --- |
| 🇨🇳 중국어 | HSK 4급 이상, 여행·일상 회화 |
| 🇺🇸 영어 | IELTS·TOEFL 만점, 원어민 수준 즉답 회화 |

## 기능

- **시트 실시간 연동** — Google Sheets GViz(JSONP) → CSV → 내장 스냅샷 순서로 읽어, 어느 한 경로가 막혀도 화면이 비지 않습니다.
- **언어 탭** — 중국어 / 영어를 오가며 통계와 기록을 봅니다. 선택은 브라우저에 저장됩니다.
- **요약 통계** — 학습 일수, 누적 문장, 새 단어, 연속 학습 일수.
- **검색** — 문장·교정·단어·병음·뜻을 즉시 필터링(하이라이트). `/` 키로 검색창 포커스.
- **복습 모드** — 교정문과 단어 뜻을 가리고, 눌러서 확인합니다.
- **복습 카드** — 교정·단어를 카드로 돌려 봅니다. Space 정답, ←/→ 이동, Esc 닫기.
- **발음 듣기** — 기기 음성 합성(Web Speech API)으로 중국어·영어 문장과 단어를 읽어 줍니다. 속도 조절 가능.
- **4주 로드맵** — HSK 4급 회화 복습 계획을 모달로 제공합니다.
- **다크/라이트 테마** — 시스템 설정을 따르고, 버튼으로 바꾸면 기억합니다.
- **오프라인 스냅샷** — `assets/snapshot.js`에 마지막으로 받아 둔 기록이 들어 있어, 시트 연결이 안 되는 환경에서도 직전 내용을 볼 수 있습니다.

## 구조

```
index.html            화면 뼈대(히어로·툴바·모달)
assets/styles.css     디자인 시스템(테마 변수, 카드, 모달, 반응형)
assets/parse.js       시트 행 → 날짜/문장/교정/단어 구조 파서 (의존성 없음)
assets/app.js         시트 로딩(GViz→CSV→스냅샷), 렌더링, 상호작용
assets/snapshot.js    시트 연결 실패 시 보여 줄 마지막 스냅샷
.nojekyll             GitHub Pages에서 Jekyll 처리 생략
```

## 시트 형식

각 시트는 첫 행이 헤더이고, 열 순서는 아래와 같습니다(헤더 이름으로도 인식).

| 날짜 | 오늘 문장 | 교정 | 새 단어 |
| --- | --- | --- | --- |
| 2026-11-19 | 문장은 줄바꿈 또는 ` / `로 구분 | `틀린 문장 → 고친 문장 / 설명` | `周末 zhōumò 주말 · 休息 xiūxi 쉬다` |

시트는 `링크가 있는 모든 사용자`에게 `뷰어`로 공개되어 있어야 앱이 읽을 수 있습니다.

## 로컬에서 보기

정적 파일이라 별도 빌드가 없습니다. 저장소 루트에서 아무 정적 서버나 띄우면 됩니다.

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## 배포

`main` 브랜치 루트를 GitHub Pages로 배포합니다. `main`에 푸시하면 1분 안에 반영됩니다.
스냅샷을 갱신하려면 `assets/snapshot.js`의 `rows`를 최근 시트 내용으로 바꿔 커밋하면 됩니다.
