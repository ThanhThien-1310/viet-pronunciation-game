import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface VocabItem {
  text: string;
  customAudio?: string;
  image?: string;
}

export interface Lesson {
  id: string;
  name: string;
  words: VocabItem[];
}

interface WordInfo {
  text: string;
  xPosition: number;
  yPosition: number;
  isActive: boolean;
  isCorrect?: boolean;
  isWrong?: boolean;
  customAudio?: string;
  image?: string;
  fallCount?: number;
  wrongAttemptCount?: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  score = signal<number>(0);
  isListening = signal<boolean>(false);
  vocabulary = signal<VocabItem[]>([]);
  defaultVi: VocabItem[] = [{ text: 'con mèo' }, { text: 'con chó' }, { text: 'ngôi nhà' }, { text: 'xe đạp' }, { text: 'bông hoa' }];
  defaultEn: VocabItem[] = [{ text: 'apple' }, { text: 'cat' }, { text: 'dog' }, { text: 'house' }, { text: 'car' }];

  lessonsVi = signal<Lesson[]>([]);
  lessonsEn = signal<Lesson[]>([]);
  activeLessonId = signal<string>('');

  remainingWords = signal<VocabItem[]>([]);
  showWinPopup = signal<boolean>(false);
  activeMicName = signal<string>('Chưa rõ nguồn thu');
  gameState = signal<'IDLE' | 'PLAYING' | 'PAUSED'>('IDLE');

  // Teacher CMS state
  isTeacherMode = signal<boolean>(false);
  newWordInput = signal<string>('');
  recordingWordText = signal<string | null>(null);

  // Settings
  gameLanguage = signal<'vi' | 'en'>('vi');
  isImageOnlyMode = signal<boolean>(false);

  // Game Mode
  gameMode = signal<'FALLING' | 'RUNNER'>('FALLING');
  runnerLives = signal<number>(3);
  runnerTimeLeft = signal<number>(100);
  runnerPosition = signal<number>(0);
  runnerIsMoving = signal<boolean>(false);
  showGameOverPopup = signal<boolean>(false);

  // Create Lesson Modal state
  pendingCreateLesson = signal<boolean>(false);
  newLessonName = signal<string>('');
  newLessonLang = signal<'vi' | 'en' | null>(null);

  private animationInterval: any;
  private recognition: any;
  private zaloAudio = new Audio();
  private isTTSPlaying = false;

  activeWord = signal<WordInfo | null>({
    text: 'Xin chào!',
    xPosition: 50,
    yPosition: 40,
    isActive: true,
    fallCount: 0
  });

  ngOnInit() {
    const savedLang = localStorage.getItem('viet-game-lang') as 'vi' | 'en';
    if (savedLang) {
      this.gameLanguage.set(savedLang);
    }

    this.loadLessonsFromStorage();
    this.initSpeechRecognition();
  }

  loadLessonsFromStorage() {
    // 1. Tải danh sách đề Tiếng Việt
    const viStr = localStorage.getItem('viet-game-lessons-vi');
    if (viStr) {
      this.lessonsVi.set(JSON.parse(viStr));
    } else {
      // Migrate dữ liệu cũ nếu có
      const oldVi = localStorage.getItem('viet-game-vocab-vi') || localStorage.getItem('viet-game-vocab');
      let defaultWords = [...this.defaultVi];
      if (oldVi) {
        try { defaultWords = JSON.parse(oldVi); } catch (e) { }
      }
      this.lessonsVi.set([{ id: 'default-vi', name: 'Đề mặc định (Tiếng Việt)', words: defaultWords }]);
    }

    // 2. Tải danh sách đề Tiếng Anh
    const enStr = localStorage.getItem('viet-game-lessons-en');
    if (enStr) {
      this.lessonsEn.set(JSON.parse(enStr));
    } else {
      const oldEn = localStorage.getItem('viet-game-vocab-en');
      let defaultWordsEn = [...this.defaultEn];
      if (oldEn) {
        try { defaultWordsEn = JSON.parse(oldEn); } catch (e) { }
      }
      this.lessonsEn.set([{ id: 'default-en', name: 'Đề mặc định (Tiếng Anh)', words: defaultWordsEn }]);
    }

    // 3. Khôi phục id đề đang chọn (nếu có)
    const savedActiveId = localStorage.getItem(`viet-game-active-lesson-${this.gameLanguage()}`);
    if (savedActiveId) {
      this.activeLessonId.set(savedActiveId);
    } else {
      this.activeLessonId.set(this.gameLanguage() === 'vi' ? 'default-vi' : 'default-en');
    }

    this.refreshActiveVocabulary();
  }

  refreshActiveVocabulary() {
    const lang = this.gameLanguage();
    const lessons = lang === 'vi' ? this.lessonsVi() : this.lessonsEn();
    let lesson = lessons.find(l => l.id === this.activeLessonId());

    // Nếu không tìm thấy (ví dụ do bị xoá), tự động chọn đề đầu tiên
    if (!lesson && lessons.length > 0) {
      lesson = lessons[0];
      this.activeLessonId.set(lesson.id);
    }

    if (lesson) {
      this.vocabulary.set([...lesson.words]);
    } else {
      this.vocabulary.set([]);
    }
  }

  saveLessonsToStorage() {
    localStorage.setItem('viet-game-lessons-vi', JSON.stringify(this.lessonsVi()));
    localStorage.setItem('viet-game-lessons-en', JSON.stringify(this.lessonsEn()));
    localStorage.setItem(`viet-game-active-lesson-${this.gameLanguage()}`, this.activeLessonId());
  }

  syncActiveLesson() {
    const lang = this.gameLanguage();
    const lessons = lang === 'vi' ? this.lessonsVi() : this.lessonsEn();
    const id = this.activeLessonId();

    const index = lessons.findIndex(l => l.id === id);
    if (index !== -1) {
      lessons[index].words = [...this.vocabulary()];
      if (lang === 'vi') {
        this.lessonsVi.set([...lessons]);
      } else {
        this.lessonsEn.set([...lessons]);
      }
      this.saveLessonsToStorage();
    }
  }

  loadVocabForLanguage(lang: 'vi' | 'en') {
    const savedVocab = localStorage.getItem(`viet-game-vocab-${lang}`);

    // Migrate old data if 'vi' is selected and no specific key exists yet
    if (!savedVocab && lang === 'vi') {
      const oldVocab = localStorage.getItem('viet-game-vocab');
      if (oldVocab) {
        try {
          this.vocabulary.set(JSON.parse(oldVocab));
          return;
        } catch (e) { }
      }
    }

    if (savedVocab) {
      try {
        this.vocabulary.set(JSON.parse(savedVocab));
      } catch (e) {
        this.vocabulary.set(lang === 'vi' ? [...this.defaultVi] : [...this.defaultEn]);
      }
    } else {
      this.vocabulary.set(lang === 'vi' ? [...this.defaultVi] : [...this.defaultEn]);
    }
  }

  initSpeechRecognition() {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognitionAPI) {
      this.detectActiveMicrophone();

      this.recognition = new SpeechRecognitionAPI();
      this.recognition.lang = this.gameLanguage() === 'vi' ? 'vi-VN' : 'en-US';
      this.recognition.continuous = true;
      this.recognition.interimResults = true; // Bật để nhận diện theo thời gian thực (nhanh hơn)

      this.recognition.onresult = (event: any) => {
        const current = event.resultIndex;
        const transcript = event.results[current][0].transcript;
        const isFinal = event.results[current].isFinal;
        console.log(`Hệ thống nghe được (final: ${isFinal}):`, transcript);
        this.checkPronunciation(transcript, isFinal);
      };

      this.recognition.onerror = (event: any) => {
        console.error('Lỗi nhận diện giọng nói:', event.error);
        if (event.error === 'not-allowed') {
          alert('Vui lòng cấp quyền sử dụng Micro để chơi game.');
          this.stopGame();
        }
      };

      this.recognition.onend = () => {
        // Tự động bật lại micro nếu game vẫn đang chơi hoặc đang dừng sửa lỗi
        if (this.gameState() === 'PLAYING' || this.gameState() === 'PAUSED') {
          try { this.recognition.start(); } catch (e) { }
        }
      }
    } else {
      console.warn('Trình duyệt không hỗ trợ Web Speech API');
    }
  }

  toggleListening() {
    if (this.gameState() === 'IDLE') {
      this.startGame('FALLING');
    } else {
      this.stopGame();
    }
  }

  toggleImageMode() {
    this.isImageOnlyMode.update(v => !v);
  }

  detectActiveMicrophone() {
    // Xin quyền mic tạm thời để lấy tên thiết bị đang được trình duyệt ưu tiên dùng
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          const track = stream.getAudioTracks()[0];
          if (track) {
            this.activeMicName.set(track.label || 'Microphone mặc định');
          }
          // Lấy tên xong thì tắt stream để nhường mic cho webkitSpeechRecognition
          stream.getTracks().forEach(t => t.stop());
        })
        .catch(err => {
          console.warn('Không thể lấy tên Mic:', err);
          this.activeMicName.set('Không thể đọc tên Mic (Có thể bị chặn quyền)');
        });
    }
  }

  startGame(mode: 'FALLING' | 'RUNNER' = 'FALLING') {
    const vocab = this.vocabulary();
    if (this.vocabulary().length === 0) {
      alert('Vui lòng nhập từ vựng trước khi chơi!');
      return;
    }
    this.gameMode.set(mode);
    this.gameState.set('PLAYING');
    this.isListening.set(true);
    this.score.set(0);
    this.remainingWords.set([...this.vocabulary()]);
    this.showWinPopup.set(false);
    this.showGameOverPopup.set(false);

    if (mode === 'RUNNER') {
      this.runnerLives.set(3);
      this.runnerTimeLeft.set(100);
      this.runnerPosition.set(0);
      this.runnerIsMoving.set(true);
    }

    if (this.recognition) {
      try { this.recognition.start(); } catch (e) { }
    }

    // Mở khóa Audio trên trình duyệt bằng cách play một âm thanh rỗng ngay khi user bấm nút
    this.zaloAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    this.zaloAudio.play().catch(() => { });

    if (mode === 'FALLING') {
      this.spawnNextWord();
      this.startAnimationLoop();
    } else {
      this.spawnRunnerWord();
      this.startRunnerLoop();
    }
  }

  startAnimationLoop() {
    if (this.animationInterval) clearInterval(this.animationInterval);
    this.animationInterval = setInterval(() => {
      const current = this.activeWord();
      if (current && current.isActive) {
        let newY = current.yPosition + 2;
        if (newY > 100) {
          this.handleWordHitGround();
        } else {
          this.activeWord.set({ ...current, yPosition: newY });
        }
      }
    }, 50);
  }

  spawnRunnerWord() {
    const vocab = this.remainingWords();
    if (vocab.length === 0) return;

    let randomWordItem = vocab[Math.floor(Math.random() * vocab.length)];

    if (vocab.length > 1) {
      const currentText = this.activeWord()?.text;
      while (randomWordItem.text === currentText) {
        randomWordItem = vocab[Math.floor(Math.random() * vocab.length)];
      }
    }

    this.activeWord.set({
      text: randomWordItem.text,
      customAudio: randomWordItem.customAudio,
      image: randomWordItem.image,
      xPosition: 80, // Vị trí chướng ngại vật
      yPosition: 60, // Trên mặt đất
      isActive: true,
      fallCount: 0,
      wrongAttemptCount: 0
    });

    if (!this.isImageOnlyMode() || !randomWordItem.image) {
      this.playWordAudio(randomWordItem.text, undefined, randomWordItem.customAudio);
    }
  }

  startRunnerLoop() {
    if (this.animationInterval) clearInterval(this.animationInterval);
    this.animationInterval = setInterval(() => {
      if (this.gameState() !== 'PLAYING') return;

      if (this.runnerIsMoving()) {
        let pos = this.runnerPosition() + 1; // Di chuyển
        if (pos === 65 && this.activeWord()?.isActive) { 
          // Dừng lại trước chướng ngại vật NẾU chưa đọc qua
          this.runnerPosition.set(pos);
          this.runnerIsMoving.set(false);
          this.runnerTimeLeft.set(100);
        } else if (pos >= 100) { 
          // Ra khỏi màn hình
          if (this.remainingWords().length === 0) {
            this.handleGameWin();
          } else {
            this.runnerPosition.set(0);
            this.spawnRunnerWord();
          }
        } else {
          this.runnerPosition.set(pos);
        }
      } else {
        // Đếm ngược thời gian
        let time = this.runnerTimeLeft() - 0.833; // Tốn ~6 giây để về 0
        if (time <= 0) {
          this.runnerTimeLeft.set(100);
          this.runnerLives.update(l => l - 1);
          this.playUISound('wrong');
          
          if (this.runnerLives() <= 0) {
            this.stopGame();
            this.gameState.set('IDLE');
            this.showGameOverPopup.set(true);
          } else {
            this.handleRunnerPassObstacle(false);
          }
        } else {
          this.runnerTimeLeft.set(time);
        }
      }
    }, 50);
  }

  handleRunnerPassObstacle(isCorrect: boolean) {
    const currentWord = this.activeWord();
    if (currentWord) {
      if (isCorrect) {
        this.score.update(s => s + 10);
        this.playUISound('correct');
        this.activeWord.set({ ...currentWord, isActive: false, isCorrect: true });
        this.playWordAudio(currentWord.text, undefined, currentWord.customAudio);
      } else {
        this.activeWord.set({ ...currentWord, isActive: false, isWrong: true });
      }
      this.remainingWords.update(words => words.filter(w => w.text !== currentWord.text));
      this.runnerIsMoving.set(true);
    }
  }

  stopGame() {
    this.gameState.set('IDLE');
    this.isListening.set(false);
    clearInterval(this.animationInterval);
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) { }
    }
    this.activeWord.set({
      text: 'Xin chào!',
      xPosition: 50,
      yPosition: 40,
      isActive: true
    });
  }

  spawnNextWord() {
    const vocab = this.remainingWords();
    if (vocab.length === 0) return;

    let randomWordItem = vocab[Math.floor(Math.random() * vocab.length)];

    // Đảm bảo không bốc trúng lại từ cũ
    if (vocab.length > 1) {
      const currentText = this.activeWord()?.text;
      while (randomWordItem.text === currentText) {
        randomWordItem = vocab[Math.floor(Math.random() * vocab.length)];
      }
    }

    this.activeWord.set({
      text: randomWordItem.text,
      customAudio: randomWordItem.customAudio,
      image: randomWordItem.image,
      xPosition: 50,
      yPosition: -10,
      isActive: true,
      fallCount: 0,
      wrongAttemptCount: 0
    });

    // Đọc ngay từ mới khi nó xuất hiện (chỉ đọc nếu không phải chế độ đoán ảnh, hoặc từ không có ảnh)
    if (!this.isImageOnlyMode() || !randomWordItem.image) {
      this.playWordAudio(randomWordItem.text, undefined, randomWordItem.customAudio);
    }
  }

  playWordAudio(wordText: string, onEnded?: () => void, customAudioBase64?: string) {
    this.isTTSPlaying = true;
    
    // Hủy các giọng đọc cũ
    window.speechSynthesis.cancel();
    this.zaloAudio.onended = null; // Xóa event cũ

    let isCallbackCalled = false;
    const safeCallback = () => {
      if (!isCallbackCalled) {
        isCallbackCalled = true;
        this.isTTSPlaying = false;
        if (onEnded) onEnded();
      }
    };

    // Đảm bảo không bị kẹt game và reset TTS state sau tối đa 2.5s
    setTimeout(safeCallback, 2500);

    // Ưu tiên phát âm thanh của giáo viên nếu có (Offline 100%)
    if (customAudioBase64) {
      this.zaloAudio.src = customAudioBase64;
      this.zaloAudio.volume = 1.0;
      this.zaloAudio.onended = safeCallback;
      this.zaloAudio.play().catch(e => {
        console.warn('Lỗi phát custom audio:', e);
        safeCallback();
      });
      return;
    }

    // Nếu là Tiếng Anh, dùng Web Speech API (Offline)
    if (this.gameLanguage() === 'en') {
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(wordText);
        utterance.lang = 'en-US';
        utterance.rate = 0.6; // Đã làm chậm lại theo yêu cầu
        utterance.onend = safeCallback;
        utterance.onerror = safeCallback; // Đảm bảo fallback gọi onEnded
        window.speechSynthesis.speak(utterance);
        return;
      } else {
        console.warn('Trình duyệt không hỗ trợ đọc Tiếng Anh Offline.');
        setTimeout(safeCallback, 100);
        return;
      }
    }

    // Nếu là Tiếng Việt, gọi Zalo AI
    const zaloApiKey = 'zfxzJyohrMH60T8HbtLfVxqPyqJKBXJg';
    const ttsUrl = 'https://api.zalo.ai/v1/tts/synthesize';
    const params = new URLSearchParams();
    params.append('input', wordText);
    params.append('speaker_id', '2'); // 2: Nữ Miền Bắc , 1: Nữ Miền Nam
    params.append('speed', '0.8'); // Chỉnh tốc độ đọc (0.8 - 1.2)

    fetch(ttsUrl, {
      method: 'POST',
      headers: {
        'apikey': zaloApiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    })
      .then(res => res.json())
      .then(data => {
        if (data.error_code === 0 && data.data && data.data.url) {
          const tryPlay = (retries: number): Promise<void> => {
            this.zaloAudio.src = data.data.url + '&t=' + Date.now();
            this.zaloAudio.volume = 1.0;
            this.zaloAudio.onended = safeCallback;
            return this.zaloAudio.play().catch(e => {
              if (retries > 0 && e.name === 'NotSupportedError') {
                return new Promise(resolve => setTimeout(resolve, 500))
                  .then(() => tryPlay(retries - 1));
              }
              throw e;
            });
          };
          return tryPlay(4);
        } else {
          throw new Error(data.error_message || 'Lỗi API Zalo');
        }
      })
      .catch(e => {
        console.warn('Cảnh báo: Không thể phát giọng Zalo AI. Hệ thống tự động dùng giọng máy tính!', e);
        const utterance = new SpeechSynthesisUtterance(wordText);
        utterance.lang = 'vi-VN';
        utterance.volume = 1.0;
        utterance.rate = 0.75;
        utterance.onend = safeCallback;
        utterance.onerror = safeCallback;

        const voices = window.speechSynthesis.getVoices();
        const viVoice = voices.find(v => v.lang === 'vi-VN' || v.lang === 'vi' || v.name.includes('Vietnamese'));
        if (viVoice) utterance.voice = viVoice;

        window.speechSynthesis.speak(utterance);
      });
  }

  handleWordHitGround() {
    const currentWord = this.activeWord();
    if (currentWord) {
      this.playUISound('wrong'); // Âm thanh rớt chữ
      
      if (!this.isImageOnlyMode() || !currentWord.image) {
        this.playWordAudio(currentWord.text, undefined, currentWord.customAudio);
      }

      const count = (currentWord.fallCount || 0) + 1;
      // Vòng chữ lại lên đầu để rơi lại
      this.activeWord.set({ ...currentWord, yPosition: -10, fallCount: count });
    }
  }

  // Tối ưu cho môi trường Offline (IIS): Dùng Web Audio API để tạo âm thanh trực tiếp
  // thay vì phải tải file .mp3 / .wav từ bên ngoài, giúp game nhẹ 0 byte và không lo lỗi đường dẫn
  playUISound(type: 'correct' | 'wrong') {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      if (type === 'correct') {
        // Tiếng "Ding!" (tần số cao, sáng)
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
        oscillator.frequency.exponentialRampToValueAtTime(1046.50, audioCtx.currentTime + 0.1); // C6
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.3);
      } else {
        // Tiếng "Boop!" (tần số thấp, báo lỗi/rớt chữ)
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(300, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.2);
      }
    } catch (e) {
      console.warn('Trình duyệt không hỗ trợ Web Audio API');
    }
  }

  normalizeString(str: string): string {
    return str.toLowerCase().replace(/[.,!?;:]/g, '').trim();
  }

  // Thuật toán tính khoảng cách chỉnh sửa giữa 2 chuỗi (Levenshtein Distance)
  getEditDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, // Thay thế
            Math.min(matrix[i][j - 1] + 1, // Chèn
              matrix[i - 1][j] + 1)); // Xóa
        }
      }
    }
    return matrix[b.length][a.length];
  }

  simulateVoice(text: string) {
    if (!text.trim()) return;
    console.log('[Dev Mode] Test nhập tĩnh:', text);
    this.checkPronunciation(text, true, true);
  }

  checkPronunciation(transcript: string, isFinal: boolean = true, isTyping: boolean = false) {
    if (this.gameState() === 'IDLE') return;
    if (this.isTTSPlaying && !isTyping) return; // Bỏ qua nếu máy đang đọc (để tránh thu lại giọng của máy)

    const currentWord = this.activeWord();
    if (!currentWord || !currentWord.isActive) return;

    const spoken = this.normalizeString(transcript);
    const target = this.normalizeString(currentWord.text);

    // 1. Chấp nhận nếu nói đúng từ đó (bao gồm cả trường hợp thu âm bị dính thêm tạp âm nhỏ)
    // Nếu nói trúng (dù là interim kết quả tạm), lập tức ăn điểm luôn cho nhanh!
    if (spoken.includes(target)) {
      this.handleCorrectPronunciation();
      return;
    }

    // Nếu người dùng chưa nói xong (interim) và chưa nói trúng, thì từ từ hẵng chấm sai
    if (!isFinal) return;

    // 2. Thuật toán "Châm chước": Kiểm tra độ giống nhau (giúp pass khi thiếu dấu, sai 1-2 chữ cái)
    const maxLen = Math.max(target.length, spoken.length);
    if (maxLen === 0) return;

    const distance = this.getEditDistance(target, spoken);
    const similarity = (maxLen - distance) / maxLen;

    // Yêu cầu độ giống nhau >= 65% (hoặc chỉ sai tối đa 2 ký tự cho các từ cực ngắn)
    if (similarity >= 0.65 || (target.length <= 5 && distance <= 2)) {
      this.handleCorrectPronunciation();
    } else {
      this.playUISound('wrong'); // Âm thanh báo sai khi nhận diện hoàn tất mà không khớp
      this.showWrongEffect(currentWord);
    }
  }

  showWrongEffect(word: WordInfo) {
    const wrongCount = (word.wrongAttemptCount || 0) + 1;
    this.activeWord.set({ ...word, isWrong: true, wrongAttemptCount: wrongCount });

    // Tắt hiệu ứng đỏ lắc lư sau 500ms để chữ tiếp tục rơi bình thường
    setTimeout(() => {
      const current = this.activeWord();
      if (current && current.text === word.text) {
        this.activeWord.set({ ...current, isWrong: false });
      }
    }, 500);
  }

  handleCorrectPronunciation() {
    if (this.gameMode() === 'RUNNER') {
      this.handleRunnerPassObstacle(true);
      return;
    }

    const currentWord = this.activeWord();
    if (currentWord) {
      const falls = currentWord.fallCount || 0;
      let points = 10; // Lần đầu: 10đ
      if (falls === 1) points = 7; // Rớt 1 lần: 7đ
      else if (falls >= 2) points = 5; // Rớt từ 2 lần trở lên: 5đ

      this.score.update(s => s + points);
      this.playUISound('correct'); // Âm thanh ting ting ăn điểm
      // Dừng chữ lại, bay về giữa màn hình, hiển thị hiệu ứng "Đúng"
      this.activeWord.set({ ...currentWord, isActive: false, isCorrect: true, yPosition: 50 });
      this.remainingWords.update(words => words.filter(w => w.text !== currentWord.text));

      // Đọc lại từ đó một lần nữa, đọc xong mới nhảy chữ tiếp theo
      this.playWordAudio(currentWord.text, () => {
        const nextAction = () => {
          if (this.remainingWords().length === 0) {
            this.handleGameWin();
          } else {
            this.spawnNextWord();
          }
        };

        if (this.isImageOnlyMode()) {
          setTimeout(nextAction, 2000);
        } else {
          nextAction();
        }
      }, currentWord.customAudio);
    }
  }

  handleGameWin() {
    this.stopGame();
    this.showWinPopup.set(true);
    this.activeWord.set(null);
  }

  returnToMainMenu() {
    this.showWinPopup.set(false);
    this.showGameOverPopup.set(false);
    this.score.set(0);
    this.remainingWords.set([]);
    this.stopGame();
  }

  pendingImportData = signal<{ name: string, words: VocabItem[] } | null>(null);
  pendingImportLanguage = signal<'vi' | 'en' | null>(null);

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          let parsedData: VocabItem[] = [];

          if (file.name.toLowerCase().endsWith('.json')) {
            const jsonData = JSON.parse(content);
            if (Array.isArray(jsonData)) {
              if (jsonData.every(item => typeof item === 'string')) {
                parsedData = jsonData.map(str => ({ text: str }));
              } else if (jsonData.every(item => item.text && typeof item.text === 'string')) {
                parsedData = jsonData;
              } else {
                throw new Error('JSON format invalid');
              }
            }
          } else {
            parsedData = content
              .split(/[\n,]+/)
              .map(word => word.trim())
              .filter(word => word.length > 0)
              .map(word => ({ text: word }));
          }

          if (parsedData.length > 0) {
            const lessonName = file.name.replace(/\.[^/.]+$/, ""); // Lấy tên file bỏ đuôi
            this.pendingImportLanguage.set(null); // Reset selection
            this.pendingImportData.set({ name: lessonName, words: parsedData });
          } else {
            alert('Không tìm thấy từ vựng nào hợp lệ trong file. Vui lòng kiểm tra lại.');
          }
        } catch (error) {
          alert('Lỗi khi đọc file. Vui lòng kiểm tra lại nội dung.');
          console.error('Error parsing file:', error);
        }
      };

      reader.readAsText(file);
      input.value = '';
    }
  }

  confirmImport() {
    const lang = this.pendingImportLanguage();
    if (!lang) return;

    const data = this.pendingImportData();
    if (!data) return;

    const newLesson: Lesson = {
      id: 'lesson-' + Date.now(),
      name: data.name,
      words: data.words
    };

    if (lang === 'vi') {
      this.lessonsVi.update(l => [...l, newLesson]);
    } else {
      this.lessonsEn.update(l => [...l, newLesson]);
    }

    if (this.gameLanguage() !== lang) {
      this.gameLanguage.set(lang);
      if (this.recognition) {
        this.recognition.lang = lang === 'vi' ? 'vi-VN' : 'en-US';
      }
    }

    this.activeLessonId.set(newLesson.id);
    this.saveLessonsToStorage();
    this.refreshActiveVocabulary();
    this.pendingImportData.set(null);
    alert(`Đã tạo bộ đề mới: "${newLesson.name}"`);
  }

  cancelImport() {
    this.pendingImportData.set(null);
  }

  // ================= LESSON MANAGEMENT =================

  changeLesson(event: Event) {
    const select = event.target as HTMLSelectElement;
    const id = select.value;

    const isVi = this.lessonsVi().some(l => l.id === id);
    const isEn = this.lessonsEn().some(l => l.id === id);

    if (isVi && this.gameLanguage() !== 'vi') {
      this.gameLanguage.set('vi');
      localStorage.setItem('viet-game-lang', 'vi');
      if (this.recognition) this.recognition.lang = 'vi-VN';
    } else if (isEn && this.gameLanguage() !== 'en') {
      this.gameLanguage.set('en');
      localStorage.setItem('viet-game-lang', 'en');
      if (this.recognition) this.recognition.lang = 'en-US';
    }

    this.activeLessonId.set(id);
    this.saveLessonsToStorage();
    this.refreshActiveVocabulary();
    this.stopGame();
  }

  createNewLesson() {
    this.newLessonName.set('Bộ đề ' + Date.now().toString().slice(-4));
    this.newLessonLang.set(this.gameLanguage()); // Default to current language
    this.pendingCreateLesson.set(true);
  }

  confirmCreateLesson() {
    const lang = this.newLessonLang();
    const name = this.newLessonName().trim();
    if (!lang || !name) return;

    const newLesson: Lesson = {
      id: 'lesson-' + Date.now(),
      name: name,
      words: []
    };

    if (lang === 'vi') {
      this.lessonsVi.update(l => [...l, newLesson]);
    } else {
      this.lessonsEn.update(l => [...l, newLesson]);
    }

    if (this.gameLanguage() !== lang) {
      this.gameLanguage.set(lang);
      if (this.recognition) {
        this.recognition.lang = lang === 'vi' ? 'vi-VN' : 'en-US';
      }
    }

    this.activeLessonId.set(newLesson.id);
    this.saveLessonsToStorage();
    this.refreshActiveVocabulary();
    this.pendingCreateLesson.set(false);
  }

  cancelCreateLesson() {
    this.pendingCreateLesson.set(false);
  }

  deleteActiveLesson() {
    const lang = this.gameLanguage();
    const lessons = lang === 'vi' ? this.lessonsVi() : this.lessonsEn();

    if (lessons.length <= 1) {
      alert('Bạn phải giữ lại ít nhất 1 bộ đề!');
      return;
    }

    if (confirm('Bạn có chắc chắn muốn xoá bộ đề này? Tất cả từ vựng và thu âm sẽ bị mất.')) {
      const newLessons = lessons.filter(l => l.id !== this.activeLessonId());
      if (lang === 'vi') {
        this.lessonsVi.set(newLessons);
      } else {
        this.lessonsEn.set(newLessons);
      }
      this.activeLessonId.set(newLessons[0].id);
      this.saveLessonsToStorage();
      this.refreshActiveVocabulary();
    }
  }

  // ================= TEACHER CMS LOGIC =================
  private mediaRecorder: any = null;
  private audioChunks: any[] = [];

  toggleTeacherMode() {
    this.isTeacherMode.update(v => !v);
    if (this.isTeacherMode()) {
      this.stopGame();
    }
  }

  addTeacherWord() {
    const word = this.newWordInput().trim().toLowerCase();
    if (word) {
      if (this.vocabulary().some(v => v.text === word)) {
        alert('Từ này đã có trong danh sách!');
        return;
      }
      this.vocabulary.update(v => [...v, { text: word }]);
      this.newWordInput.set('');
      this.syncActiveLesson();
    }
  }

  deleteTeacherWord(index: number) {
    this.vocabulary.update(v => v.filter((_, i) => i !== index));
    this.syncActiveLesson();
  }

  startRecording(item: VocabItem) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Trình duyệt của bạn không hỗ trợ thu âm trực tiếp.');
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const MediaRecorderApi = (window as any).MediaRecorder;
      this.mediaRecorder = new MediaRecorderApi(stream);
      this.mediaRecorder.start();
      this.audioChunks = [];
      this.recordingWordText.set(item.text);

      this.mediaRecorder.addEventListener("dataavailable", (event: any) => {
        this.audioChunks.push(event.data);
      });

      this.mediaRecorder.addEventListener("stop", () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          this.vocabulary.update(v => {
            const index = v.findIndex(x => x.text === item.text);
            if (index !== -1) {
              v[index].customAudio = reader.result as string;
            }
            return [...v];
          });
          this.syncActiveLesson();
        };
        // Dừng sử dụng mic
        stream.getTracks().forEach(track => track.stop());
      });
    }).catch(err => {
      alert('Không thể truy cập Microphone: ' + err.message);
    });
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.recordingWordText.set(null);
    }
  }

  playTeacherAudio(item: VocabItem) {
    if (item.customAudio) {
      const audio = new Audio(item.customAudio);
      audio.play();
    }
  }

  exportTeacherData() {
    const dataStr = JSON.stringify(this.vocabulary(), null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = 'bai-giang-tu-vung.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    document.body.appendChild(linkElement);
    linkElement.click();
    document.body.removeChild(linkElement);
  }

  onImageSelected(event: Event, item: VocabItem) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      if (!file.type.startsWith('image/')) {
        alert('Vui lòng chọn file hình ảnh (jpg, png...)');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        this.vocabulary.update(v => {
          const index = v.findIndex(x => x.text === item.text);
          if (index !== -1) {
            v[index].image = reader.result as string;
          }
          return [...v];
        });
        this.syncActiveLesson();
      };
      reader.readAsDataURL(file);
      input.value = '';
    }
  }
}
