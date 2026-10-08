# 배포 (GitHub Pages)

`main`에 올리면 `.github/workflows/deploy.yml`이 테스트 → 빌드 → GitHub Pages 배포를 한다. 주소는 `https://<계정>.github.io/<저장소 이름>/`.

## 처음 한 번

1. GitHub에서 빈 저장소를 만든다 (README 없이). 무료 계정에서 Pages는 **공개 저장소**에서만 쓸 수 있다.
2. 이 폴더에서 원격을 더하고 올린다:
   ```bash
   git remote add origin https://github.com/<계정>/<저장소>.git
   git push -u origin main
   ```
   처음 올릴 때 Git Credential Manager가 브라우저 로그인 창을 띄운다.
3. 저장소 Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 바꾼다.
4. Actions 탭에서 `deploy`가 끝나면 주소가 나온다. 실패하면 Actions 탭의 로그를 본다.

## 알아 둘 것

- 배포 경로는 `BASE_PATH=/<저장소 이름>/`로 빌드한다 (`vite.config.ts`). 로컬에서 같은 빌드를 보려면 Git Bash에서는 경로 변환을 꺼야 한다: `MSYS_NO_PATHCONV=1 BASE_PATH=/kbo-gm/ npm run build`.
- 공개 저장소에 올리면 코드와 `public/data/`(선수 실명·기록)가 모두 공개된다. 데이터 권리 문제는 `docs/release-1.0-gaps.md` A항.
- 저장은 각 사용자 브라우저(IndexedDB)에만 남는다. 배포 주소가 바뀌면(저장소 이름 변경) 예전 저장이 보이지 않는다.
