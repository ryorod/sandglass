import { useEffect, useState } from "react";
import dayjs from "dayjs";

export default function Info() {
  const [date, setDate] = useState(dayjs());

  useEffect(() => {
    const timer = setInterval(() => {
      setDate(dayjs());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        bottom: "40px",
        left: "50px",
        fontSize: "30px",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <p>TIME&ensp;{date.format("HH : mm")}</p>
      <p>DATE&ensp;{date.format("YYYY - MM - DD")} T</p>
      <p>TIME ZONE ASIA / TOKYO</p>
      <p>TEMPERATURE&ensp;14.5℃</p>
      <p>WIND SPEED&ensp;3.7 KM/H&ensp;|&ensp;DIRECTION&ensp;SOUTH</p>
    </div>
  );
}
