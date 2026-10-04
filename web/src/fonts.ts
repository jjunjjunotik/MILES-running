/**
 * 글꼴은 직접 호스팅한다. 외부 글꼴 서버에 접속 기록을 남기지 않기 위해서다.
 *
 * 본문과 화면 글자는 IBM Plex Sans, 수치(관찰 지표, 변화량)는 IBM Plex Mono 로 쓴다.
 * 글꼴은 문자 범위(라틴, 라틴 확장 등)별로 나뉘어 있어서, 화면에 실제로 나온 범위만 내려받는다.
 * 굵기는 400 과 600 두 가지만 쓴다.
 */
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
// 한글은 IBM Plex Sans KR 로. 글자 범위별로 잘게 나뉘어 있어서, 화면에 한글이 나올 때
// 그 글자가 든 조각만 내려받는다. 영어로만 쓰면 받지 않는다.
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-mono/500.css";
