# 메인 기기 적용 메모 (2026-11-24, 노트북에서 작성)

다른 기기에서 정한 내용을 메인 기기에서도 바로 쓰기 위한 메모입니다.
메인 기기의 Claude에게 **"KM-Crew/photo-song 의 docs/MAIN_DEVICE.md 읽고 적용해"** 라고 하면 아래를 따릅니다.

## 1. 메모리에 저장할 것 (Claude 메모리, 기존 항목이 있으면 고쳐 쓰기)

| 이름 | 내용 |
|---|---|
| 하입바이브 출품작 | 하입바이브 하입소문 공모전(마감 2026-11-30 23:59, 제출 후 수정 불가) 출품작은 **색의 노래 — 사진을 넣으면 분석해서 노래로**. 저장소 `KM-Crew/photo-song`(주소 https://km-crew.github.io/photo-song/). 진행은 그 저장소 `PROGRESS.md` |
| "백업된 자료 로드해" | 사용자가 다른 지시 없이 이렇게 말하면 **photo-song(이미지로 노래 만들기 사이트)** 내용을 불러온다: `git fetch`·pull → `PROGRESS.md`·`AGENTS.md` 읽기 → 현재 상태와 다음 할 일 보고 |
| 공모전 항상 배포 | KM-Crew 저장소 수정은 테스트 통과 후 **묻지 않고** 브랜치 → PR → 스쿼시 병합(`gh pr merge <번호> -R KM-Crew/<저장소> --squash --delete-branch`, 다른 명령과 묶지 말고 단독 실행) → Pages 배포 확인(`gh run watch`) → 바뀐 화면을 `?v=<유닉스시간>#/<화면>` 주소로 브라우저에 띄운다. js·css를 고치면 `index.html`의 `?v=` 값을 올린다 |
| 모바일 먼저 | 사용자는 주로 휴대폰으로 시험한다. 모바일을 먼저 맞추고 PC(900px 이상 2단)도 되게 한다 |
| 후보 10개 백업 | 후보 10개가 든 허브(km-crew.github.io)와 10개 저장소는 태그 `backup/10-candidates-2026-11-24`로 백업. 기록(workspace `docs/contest-hypevibe` 브랜치)은 태그 `backup/contest-records-2026-11-24`. 사이트는 지우지 않고 그대로 둠 |

## 2. 처음 한 번 할 일

1. `KM-Crew` 폴더(다른 저장소들과 같은 곳)에서 `gh repo clone KM-Crew/photo-song`
2. 그 저장소에 git 사용자 이름·메일을 저장소 단위로 설정(다른 KM-Crew 저장소와 같은 값)
3. 테스트 준비: `workspace/qa`에 puppeteer(-core)가 없으면 `npm install`
4. 확인: KM-Crew 폴더에서 `python -m http.server 8790 --bind 127.0.0.1` → photo-song에서 `node test/run.js && node test/app.js`

## 3. 다른 기기와 번갈아 작업할 때

- 시작 전에 `git fetch` → `git pull`. 끝나면 `PROGRESS.md` 갱신 후 PR 병합까지 해 둔다(다른 기기가 바로 이어받게).
- 이 메모가 바뀌면 PR 설명에 "MAIN_DEVICE.md 갱신"을 적는다.
