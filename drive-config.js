/*
 * lecture-editor 구글 드라이브 연동 설정
 * ---------------------------------------------------------------------------
 * 이 파일의 값은 "비밀"이 아니라 공개 식별자입니다.
 *   - CLIENT_ID : OAuth 2.0 클라이언트 ID. 승인된 자바스크립트 원본(https://teo-kt.github.io)에서만 동작합니다.
 *   - API_KEY   : Google Picker(파일 선택창)용 키. 반드시 "HTTP 리퍼러 제한"(https://teo-kt.github.io/*)과
 *                 "API 제한"(Google Picker API, Google Drive API)을 걸어 두어야 합니다. 그러면 공개돼도 안전합니다.
 *   - APP_ID    : GCP 프로젝트 번호(숫자).
 *
 * 권한 범위는 drive.file 하나만 요청합니다. 즉 이 에디터는 사용자가 선택창에서 직접 고른 파일에만
 * 접근할 수 있고, 드라이브의 다른 파일은 목록조차 볼 수 없습니다. 액세스 토큰은 브라우저 메모리에만
 * 두며(저장소에 기록하지 않음) 탭을 닫으면 사라집니다.
 *
 * 값을 비워 두면 드라이브 버튼은 안내만 표시하고, 나머지 편집 기능은 그대로 동작합니다.
 * (htmlbook-drive 와 같은 GCP 프로젝트/클라이언트를 공유합니다.)
 */
window.LECTURE_EDITOR_DRIVE = {
  CLIENT_ID: "740491906618-cgr9tsnoo4rliagvd2mkmst6chau9tn7.apps.googleusercontent.com",
  API_KEY: "AIzaSyB9h7uqTFck6vK-DoYQshmNDBzHLRLeofw",
  APP_ID: "740491906618",
};
