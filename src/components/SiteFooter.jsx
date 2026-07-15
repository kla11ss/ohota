import { ArrowUpRight, Phone } from "@phosphor-icons/react";

export function SiteFooter() {
  return (
    <footer className="site-footer" id="site-footer">
      <div className="page-shell footer-top">
        <div>
          <p className="footer-kicker">Охотничье хозяйство</p>
          <p>Село Великовское, Лысковский район, Нижегородская область</p>
        </div>
        <a href="tel:+79200201516">
          <Phone size={16} weight="regular" /> +7 920 020-15-16
        </a>
        <a href="#top">
          Наверх <ArrowUpRight size={16} weight="regular" />
        </a>
      </div>

      <div className="footer-wordmark" aria-label="Великовское">
        ВЕЛИКОВСКОЕ
      </div>

      <div className="page-shell footer-bottom">
        <p>Информация о сроках, ценах и доступности услуг подтверждается перед поездкой.</p>
        <p>© {new Date().getFullYear()} Великовское</p>
      </div>
    </footer>
  );
}
