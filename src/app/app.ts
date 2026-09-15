import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

interface WordInfo {
  text: string;
  xPosition: number;
  yPosition: number;
  isActive: boolean;
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
  vocabulary = signal<string[]>(['con mèo', 'con chó', 'ngôi nhà', 'xe đạp', 'bông hoa']);
  gameState = signal<'IDLE' | 'PLAYING' | 'PAUSED'>('IDLE');
  
  private animationInterval: any;
  private recognition: any;
  
  activeWord = signal<WordInfo | null>({
    text: 'Xin chào!',
    xPosition: 50,
    yPosition: 40,
    isActive: true
  });

  ngOnInit() {
    const savedVocab = localStorage.getItem('viet-game-vocab');
    if (savedVocab) {
      try {
        this.vocabulary.set(JSON.parse(savedVocab));
      } catch (e) {
        console.error('Failed to parse saved vocabulary');
      }
    }
    this.initSpeechRecognition();
  }

  initSpeechRecognition() {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognitionAPI) {
      this.recognition = new SpeechRecognitionAPI();
      this.recognition.lang = 'vi-VN';
      this.recognition.continuous = true;
      this.recognition.interimResults = false;

      this.recognition.onresult = (event: any) => {
        const current = event.resultIndex;
        const transcript = event.results[current][0].transcript;
        console.log('Hệ thống nghe được:', transcript);
        this.checkPronunciation(transcript);
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
          try { this.recognition.start(); } catch (e) {}
        }
      }
    } else {
      console.warn('Trình duyệt không hỗ trợ Web Speech API');
    }
  }

  toggleListening() {
    if (this.gameState() === 'IDLE') {
      this.startGame();
    } else {
      this.stopGame();
    }
  }

  startGame() {
    const vocab = this.vocabulary();
    if (vocab.length === 0) {
      alert('Vui lòng nhập từ vựng trước khi bắt đầu!');
      return;
    }

    this.gameState.set('PLAYING');
    this.isListening.set(true);
    this.score.set(0);
    
    if (this.recognition) {
      try { this.recognition.start(); } catch (e) {}
    }

    this.spawnNextWord();
    this.startAnimationLoop();
  }

  startAnimationLoop() {
    if (this.animationInterval) clearInterval(this.animationInterval);
    this.animationInterval = setInterval(() => {
      const current = this.activeWord();
      if (current && current.isActive) {
        let newY = current.yPosition + 0.8; 
        if (newY > 100) {
          this.handleWordHitGround(); 
        } else {
          this.activeWord.set({ ...current, yPosition: newY });
        }
      }
    }, 50);
  }

  stopGame() {
    this.gameState.set('IDLE');
    this.isListening.set(false);
    clearInterval(this.animationInterval);
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
    }
    this.activeWord.set({
      text: 'Xin chào!',
      xPosition: 50,
      yPosition: 40,
      isActive: true
    });
  }

  spawnNextWord() {
    const vocab = this.vocabulary();
    const randomWord = vocab[Math.floor(Math.random() * vocab.length)];
    this.activeWord.set({
      text: randomWord,
      xPosition: 50,
      yPosition: -10,
      isActive: true
    });
  }

  handleWordHitGround() {
    const currentWord = this.activeWord();
    if (currentWord) {
       const zaloApiKey = 'zfxzJyohrMH60T8HbtLfVxqPyqJKBXJg';
       const ttsUrl = 'https://api.zalo.ai/v1/tts/synthesize';
       const params = new URLSearchParams();
       params.append('input', currentWord.text);
       params.append('speaker_id', '2'); // 2: Nữ Miền Bắc (chuẩn và dễ nghe), 1: Nữ Miền Nam
       params.append('speed', '0.8'); // Chỉnh tốc độ đọc chậm nhất của Zalo AI (0.8 - 1.2)

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
           const audio = new Audio(data.data.url);
           audio.volume = 1.0;
           return audio.play(); // Trả về Promise để nếu lỗi sẽ nhảy xuống catch bên dưới
         } else {
           throw new Error(data.error_message || 'Lỗi API Zalo');
         }
       })
       .catch(e => {
         console.warn('Cảnh báo: Không thể phát giọng Zalo AI. Hệ thống tự động dùng giọng máy tính!', e);
         const utterance = new SpeechSynthesisUtterance(currentWord.text);
         utterance.lang = 'vi-VN';
         utterance.volume = 1.0;
         utterance.rate = 0.75;
         
         const voices = window.speechSynthesis.getVoices();
         const viVoice = voices.find(v => v.lang === 'vi-VN' || v.lang === 'vi' || v.name.includes('Vietnamese'));
         if (viVoice) utterance.voice = viVoice;
         
         window.speechSynthesis.speak(utterance);
       });
       
       // Vòng chữ lại lên đầu để rơi lại
       this.activeWord.set({ ...currentWord, yPosition: -10 });
    }
  }

  normalizeString(str: string): string {
    return str.toLowerCase().replace(/[.,!?;:]/g, '').trim();
  }

  checkPronunciation(transcript: string) {
    if (this.gameState() === 'IDLE') return;

    const currentWord = this.activeWord();
    if (!currentWord || !currentWord.isActive) return;

    const spoken = this.normalizeString(transcript);
    const target = this.normalizeString(currentWord.text);

    // Chấp nhận nếu nói đúng từ đó (bao gồm cả trường hợp thu âm bị dính thêm tạp âm nhỏ)
    if (spoken.includes(target) || (target.includes(spoken) && spoken.length >= Math.max(target.length - 2, 2))) {
       this.handleCorrectPronunciation();
    }
  }

  handleCorrectPronunciation() {
    this.score.update(s => s + 10);
    this.spawnNextWord();
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          let parsedData: string[] = [];

          if (file.name.toLowerCase().endsWith('.json')) {
            const jsonData = JSON.parse(content);
            if (Array.isArray(jsonData) && jsonData.every(item => typeof item === 'string')) {
              parsedData = jsonData;
            } else {
              throw new Error('JSON format invalid');
            }
          } else {
            parsedData = content
              .split(/[\n,]+/) 
              .map(word => word.trim())
              .filter(word => word.length > 0);
          }
          
          if (parsedData.length > 0) {
            this.vocabulary.set(parsedData);
            localStorage.setItem('viet-game-vocab', JSON.stringify(parsedData));
            alert(`Đã nhập thành công ${parsedData.length} từ vựng!`);
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
}
