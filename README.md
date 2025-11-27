# 지리 히트맵 대시보드 (Geo Dashboard)

CSV를 브라우저에서만 읽어 글로벌 히트맵, 상승/하락 국가, 대륙별 뉴스까지 한 페이지에서 확인하는 대시보드입니다.

## 특징

- 🌍 **글로벌 트리맵 히트맵**: 대륙→국가 계층 구조로 데이터 시각화
- 📈 **상승/하락 국가**: 임계값 기반 상승/하락 국가 목록
- 📊 **국가 상세**: 시계열 차트와 상세 정보
- 📰 **대륙별 뉴스**: 대륙별로 그룹화된 뉴스 목록
- 🔒 **완전 로컬 처리**: 모든 데이터 처리는 브라우저에서만 수행되며 외부로 전송되지 않습니다

## 사용 방법

1. `index.html` 파일을 브라우저에서 엽니다
2. CSV 파일을 업로드합니다:
   - **지표 CSV (필수)**: 날짜, 국가 코드/이름, 대륙, 값, 변화율
   - **뉴스 CSV (선택)**: continent, title, url, summary
   - **상세정보 CSV (선택)**: country_code, section, title, detail, url
   - **매핑 CSV (선택)**: country_code, continent, country_name
3. 컬럼 매핑을 확인/수정합니다
4. 보기 옵션을 설정합니다

## CSV 형식 예시

### 지표 CSV
```csv
Date,code,name,continent,value,change_pct
2025-06-01,US,United States,North America,12345,2.1
2025-06-01,DE,Germany,Europe,9981,-1.7
2025-06-01,KR,South Korea,Asia,3310,3.2
```

### 뉴스 CSV
```csv
continent,title,url,summary
Asia,한국 경제 성장,https://example.com/news1,한국 경제가 3% 성장
Europe,유럽 연합 회의,https://example.com/news2,EU 정상회의 개최
```

### 매핑 CSV
```csv
country_code,continent,country_name
US,North America,United States
KR,Asia,South Korea
DE,Europe,Germany
```

## 기술 스택

- **Plotly.js**: 트리맵 히트맵 시각화
- **Chart.js**: 시계열 차트
- **PapaParse**: CSV 파싱
- 순수 JavaScript (모듈 없음)

## 라이선스

MIT License

