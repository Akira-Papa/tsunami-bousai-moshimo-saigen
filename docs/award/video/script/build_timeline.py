#!/usr/bin/env python3
"""シーン別ナレーションWAVからタイムライン・字幕SRT・仮通しナレーションWAVを作る。

使い方: python3 build_timeline.py
- 尺は ffprobe で実測する（fish_tts.py のWAVはヘッダの長さ欄が壊れているため wave モジュールは使わない）
- 字幕は表示用の文（読み替え前の表記）を、シーン内で文字数比例に割り付ける
"""
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIO = HERE / "音声"

# (シーンID, 音声ファイル名, 前の間(秒), 後の間(秒), 字幕の表示文)
SCENES = [
    ("S01", "S01_冒頭", 1.2, 0.8,
     "地図で、ひとつの街を選んでください。|その街の本当の地形と建物の上を、|仮定の津波が、水として流れはじめます。"),
    ("S02", "S02_タイトル", 0.6, 1.0,
     "建物にぶつかり、回り込み、運河をさかのぼる。|津波防災もしも再現は、その動きを|ブラウザの中で物理計算して見せるサイトです。"),
    ("S03", "S03_PLATEAU実測高さ", 0.6, 0.8,
     "街の建物は、3D都市モデル、PLATEAUの公式データです。|名古屋の5区、およそ25万8千棟。|実測の高さ、階数、用途を持つ建物ひとつひとつが、|水をはね返す壁になります。"),
    ("S04", "S04_物理計算", 0.6, 0.8,
     "計算範囲は、およそ1.5km四方。|これを約2mの格子に分けて、|非線形浅水方程式を、WebGPUで解いています。|押し波の先端は、崩れずに、水の壁のまま進みます。"),
    ("S05", "S05_防潮壁", 0.6, 1.0,
     "名古屋港では、満潮の潮位、標高1.2mから始めます。|岸には、高さ4.6mの防潮壁。|水が越えたところから、壊れていきます。|公式の想定と、同じ条件です。"),
    ("S06", "S06_目線視点", 0.6, 0.8,
     "目線の高さに立つと、1mごとの目盛りと、|身長170cmの人影、2階の床の線が見えます。|画面の言葉は、海岸での「海の高さ」と、|足元の「ここの深さ」。この二つだけにしました。"),
    ("S07", "S07_ゼロメートル地帯", 0.6, 1.0,
     "港区善進本町は、海面より低い、海抜ゼロメートル地帯です。|水は運河をさかのぼり、線路の盛土で止まりました。|そして、一度入った水は、自然には引きません。"),
    ("S08", "S08_名古屋駅広域", 0.6, 0.8,
     "海から遠い名古屋駅も選べます。|14km四方の広域で、海から港へ、川や運河へ、|そして市街地へと広がる水を計算し、|地点の周りだけを細かい格子で解く、二段の計算です。"),
    ("S09", "S09_公式比較", 0.6, 0.8,
     "結果の画面では、内閣府の2025年の想定と並べます。|名古屋港の地点で、この再現は最大1.74m。|周りの100m四方では、2.27m。|公式の100m集約は、1.27mです。"),
    ("S10", "S10_木造流失と垂直避難", 0.6, 0.8,
     "木造の家は、浸水が2mを超えると、流されて、がれきになります。|名古屋港では、938棟が流されました。|地点から300m以内の、高く丈夫な建物は橙色、|指定緊急避難場所は緑。|指定されているかは、自治体の情報でご確認ください。"),
    ("S11", "S11_締め", 0.8, 3.0,
     "これは、予測ではありません。|避難は、自治体のハザードマップで。|強い揺れを感じたら、この結果を待たずに、高いところへ。|あなたの街でも、一度、水の動きを見てみませんか。"),
]


def duration(p: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def ts(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def weight(text: str) -> int:
    return max(1, len(re.sub(r"[、。「」,.\s]", "", text)))


def main() -> None:
    t = 0.0
    rows, cues, parts = [], [], []
    for sid, name, pre, post, disp in SCENES:
        wav = AUDIO / f"{name}.wav"
        d = duration(wav)
        start = t
        v_start = t + pre
        end = v_start + d + post
        rows.append({"scene": sid, "file": f"音声/{name}.wav", "start": round(start, 2),
                     "voice_start": round(v_start, 2), "voice_sec": round(d, 2),
                     "end": round(end, 2), "scene_sec": round(end - start, 2)})
        lines = disp.split("|")
        total_w = sum(weight(x) for x in lines)
        c = v_start
        for i, line in enumerate(lines):
            seg = d * weight(line) / total_w
            c_end = c + seg if i < len(lines) - 1 else v_start + d + min(post, 0.6)
            cues.append((c, c_end, line))
            c += seg
        parts.append((pre, wav, post))
        t = end

    (HERE / "字幕.srt").write_text(
        "\n".join(f"{i}\n{ts(a)} --> {ts(b)}\n{txt}\n" for i, (a, b, txt) in enumerate(cues, 1)),
        encoding="utf-8")
    (HERE / "タイムライン.json").write_text(
        json.dumps({"total_sec": round(t, 2), "scenes": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8")

    # 仮通しナレーション（無音の間を挟んで連結。48kHz/mono/16bitにそろえる）
    args, filt, n = ["ffmpeg", "-y", "-v", "error"], [], 0
    for pre, wav, post in parts:
        args += ["-i", str(wav)]
        filt.append(f"[{n}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono,"
                    f"adelay={int(pre*1000)}:all=1,apad=pad_dur={post}[a{n}]")
        n += 1
    filt.append("".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[out]")
    args += ["-filter_complex", ";".join(filt), "-map", "[out]", str(HERE / "音声" / "00_仮通しナレーション.wav")]
    subprocess.run(args, check=True)

    for r in rows:
        print(r)
    print("total_sec", round(t, 2))


if __name__ == "__main__":
    main()
