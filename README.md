# 화상강의 플랫폼

실시간 비디오 화상강의 플랫폼입니다.

## 🚀 배포 방법

### Render.com 무료 배포 (추천)

**1. GitHub에 코드 올리기**

```bash
# Git 초기화 (처음 한 번만)
git init
git add .
git commit -m "Initial commit"

# GitHub 저장소와 연결
git remote add origin https://github.com/[사용자명]/[저장소명].git
git push -u origin main
```

**2. Render 배포**

1. [Render.com](https://render.com) 무료 가입
2. "New +" → "Web Service" 클릭
3. GitHub 저장소 연결
4. 설정:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. "Create Web Service" 클릭
6. 배포 완료! (5-10분 소요)

**3. 사용하기**

배포 완료 후 제공되는 URL (예: `https://video-lecture.onrender.com`)로 접속하면 됩니다.

---

## 📱 로컬 실행

```bash
npm install
npm start
```

`http://localhost:3000` 접속

---

## 🎓 사용법

### 선생님
1. 접속 → 이름 입력 → 강의실 ID 입력
2. "선생님으로 시작" 클릭
3. "초대 링크 복사" 버튼 클릭
4. 학생들에게 링크 전송

### 학생
1. 선생님이 보낸 링크 클릭
2. 이름 입력 → "입장하기"
3. 선생님 승인 대기
4. 입장 완료!

---

## 🔧 기능

- ✅ 실시간 비디오/오디오 통신
- ✅ 화면 공유
- ✅ 실시간 채팅
- ✅ 화이트보드 (그리기, 색상 선택, 지우개)
- ✅ 대기실 (선생님 승인 시스템)
- ✅ 초대 링크 자동 생성

---

## ⚙️ 기술 스택

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: HTML, CSS, JavaScript
- **WebRTC**: 실시간 통신
