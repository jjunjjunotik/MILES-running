/**
 * 글꼴은 직접 호스팅한다. 외부 글꼴 서버에 접속 기록을 남기지 않기 위해서다.
 *
 * 본문과 화면 글자는 IBM Plex Sans KR, 수치(관찰 지표, 변화량)는 IBM Plex Mono 로 쓴다.
 * 한글 글꼴은 글자 범위별로 잘게 나뉘어 있어서, 화면에 실제로 나온 글자의 조각만 내려받는다.
 * 굵기는 400 과 600 두 가지만 쓴다. 굵기 하나마다 내려받을 조각이 그만큼 늘어난다.
 */
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-mono/500.css";
