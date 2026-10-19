import React from "react";
import { Button, Modal } from "./ui";
import wechatQr from "../../public/payment/wechat-contact.jpg";
import "./ticket-payment.css";

export default function TicketPayment({ price, onClose, onContinue }) {
  return (
    <Modal title="微信购票" onClose={onClose}>
      <div className="ticket-payment">
        <span className="eyebrow">阿拉斯加之夜 · 最后的遗嘱</span>
        <p className="ticket-payment-price">¥{price}<small> / 位</small></p>
        <p>扫描二维码添加微信，联系付款。</p>
        <img src={wechatQr} alt="活动联系人的微信加好友二维码" width="888" height="1131" />
        <p className="muted">手机上可长按保存图片，在微信中识别。付款时请备注报名手机号，由工作人员核验票务。</p>
        <a className="text-link" href={wechatQr} download="阿拉斯加之夜-微信二维码.jpg">保存微信二维码</a>
        {onContinue && <Button kind="ghost" onClick={onContinue}>返回报名 / 我的角色</Button>}
      </div>
    </Modal>
  );
}
