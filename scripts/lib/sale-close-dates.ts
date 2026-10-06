/**
 * sale-close-dates.ts — the ACTUAL close day of every REA / Huggins & Scott
 * catalog sale in the corpus, with the source each one was read from.
 *
 * WHY (identity fix wave, Oct 2026): both archives post only the sale's label
 * ("2019 Summer", "2022 February"), and seasonToDate turned the label into a
 * mid-month stub (Summer → 07-15, Fall → 10-15) stamped datePrecision 'month'
 * — so knownKey() treated the results as known at the END of the label month.
 * The sales actually close weeks later: REA Summer mid-August, REA Fall early
 * December, H&S Summer early September, and H&S's month labels run 0–2 months
 * AHEAD of the close (H&S "2022 February" = the Spring sale that closed April
 * 7). Every replay cut that fell between the stub month-end and the real close
 * saw prices it could not have known (lookahead).
 *
 * CONTRACT
 *  · a table row → the close day (house-local, the scheduled final night; REA /
 *    H&S extended bidding can run past midnight ET, so the calendar day is the
 *    night the sale closes). precision 'day' unless the row says 'season'.
 *  · no row, season-labelled → the conservative END of the season's quarter
 *    (Winter 03-31 · Spring 06-30 · Summer 09-30 · Fall 12-31), precision
 *    'season': never earlier than any close either house has used for that
 *    season label, and never across a quarter boundary from the old stub.
 *  · no row, H&S month-labelled → the last day of the month TWO after the
 *    label, precision 'season' (the widest lag in the table: "2022 February"
 *    closed April 7; scripts/__tests__/season-dates.test.ts holds every cited
 *    H&S month row to this bound).
 *  · no row, REA month-labelled ("2026 January") → null: REA's monthly
 *    auctions close inside their label month (collectrea.com/about/schedule,
 *    2025 + 2026), so the month stub is already a safe upper bound.
 *  · a date after `asOf` is clamped to `asOf` (a sold row is known by the day
 *    it was read — never future-date a settled sale).
 *
 * Sources: Wayback captures are cited as wb:<timestamp>/<host> (resolve as
 * https://web.archive.org/web/<timestamp>/<host>/); AR = auctionreport.com.
 */

export type ClosePrecision = 'day' | 'season';
type Row = { close: string; precision?: 'season'; src: string };

const AR_HS = 'https://www.auctionreport.com/category/huggins-scott-news/';

/* ── REA (Robert Edward Auctions) catalog sales ─────────────────────────── */
const REA: Record<string, Row> = {
  '2004 Spring': { close: '2004-05-01', src: 'wb:20040518163258/robertedwardauctions.com "final day of bidding (May 1, 2004)"' },
  '2005 Spring': { close: '2005-04-30', src: 'wb:20050521030400/robertedwardauctions.com "final day of bidding … Saturday, April 30, 2005"' },
  '2006 Spring': { close: '2006-04-29', src: 'wb:20060417173718/robertedwardauctions.com "final date of bidding is April 29, 2006"' },
  '2007 Spring': { close: '2007-04-28', src: 'wb:20070426032429/robertedwardauctions.com "final day of bidding is Saturday April 28, 2007"' },
  '2008 Spring': { close: '2008-05-03', src: 'https://www.newtownbee.com/05282008/robert-edwards-sells-1914-ruth-rookie-card-for-5170009-07-million-in-sal/ ("May 3, 2008 auction")' },
  '2009 Spring': { close: '2009-05-02', src: 'wb:20090330080256/robertedwardauctions.com "Final day of bidding is May 2, 2009"' },
  '2010 Spring': { close: '2010-05-01', src: 'wb:20100428081206/robertedwardauctions.com "Final day of bidding is May 1st, 2010"' },
  '2011 Spring': { close: '2011-05-07', src: 'https://www.abebooks.com/book-search/title/robert-edward-auctions/ (catalog "closed Saturday, May 7, 2011")' },
  '2012 Spring': { close: '2012-05-12', src: 'wb:20120408163920/robertedwardauctions.com "Final day of bidding is May 12"' },
  '2013 Spring': { close: '2013-05-18', src: 'wb:20130512214406/robertedwardauctions.com "Auction Ends: May 18"' },
  '2013 Fall': { close: '2013-10-19', src: 'wb:20131114092951/robertedwardauctions.com "Auction Ends: Oct. 19"' },
  '2014 Spring': { close: '2014-04-26', src: 'wb:20141019210407/robertedwardauctions.com "2014 Spring Auction … Auction Ends: April 26"' },
  '2014 Fall': { close: '2014-10-19', src: 'wb:20141019210407/robertedwardauctions.com "2014 Fall Auction … Auction ends Oct. 19"' },
  '2015 Spring': { close: '2015-04-25', src: 'wb:20150313074702/robertedwardauctions.com "Bidding Ends: April 25"' },
  '2015 Fall': { close: '2015-10-17', src: 'wb:20151017082201/robertedwardauctions.com "Fall 2015 Auction Closes Saturday October 17"' },
  '2016 Spring': { close: '2016-04-30', src: 'wb:20160312162044/robertedwardauctions.com "Bidding Ends April 30"' },
  '2016 Fall': { close: '2016-10-30', src: 'wb:20161007095248/robertedwardauctions.com "Bidding Ends October 30th"' },
  '2017 Spring': { close: '2017-04-30', src: 'wb:20170410153814/robertedwardauctions.com "Bidding Ends April 30"' },
  '2017 Fall': { close: '2017-10-29', src: 'https://www.auctionreport.com/rea-fall-auction-set-to-begin-october-6-featuring-2800-lots/ ("REA October 29, 2017 Auction")' },
  '2018 Spring': { close: '2018-05-06', src: 'wb:20180417122908/robertedwardauctions.com "Spring Auction Is Open For Bidding! Auction Closes May 6"' },
  '2018 Fall': { close: '2018-10-28', src: 'wb:20181011143818/robertedwardauctions.com "Fall Auction Is Open For Bidding! Auction Closes October 28"' },
  '2019 Spring': { close: '2019-03-24', src: 'https://www.sportscollectorsdaily.com/robert-edward-auctions-spring-2019/ (opened March 6, closed March 24)' },
  '2019 Summer': { close: '2019-08-18', src: 'wb:20190721222352/robertedwardauctions.com "Bidding Opens July 26. Auction Ends August 18"' },
  '2019 Fall': { close: '2019-12-08', src: 'wb:20191112130608/robertedwardauctions.com "2019 Fall Auction Now Open! Bidding Ends December 8"' },
  // standalone T206 set break: "Scheduled For February 20" (Jan 28 2020 news),
  // "T206 Set Break Nets $207,000!" (Mar 02 2020 news) — close bounded by the
  // results post; the corpus sale totals $207,603 (608 lots).
  '2020 T206': { close: '2020-03-02', precision: 'season', src: 'wb:20201228192124/robertedwardauctions.com news "T206 Set Break Nets $207,000! Mar 02"; wb:20200319131914 "Scheduled For February 20"' },
  '2020 Spring': { close: '2020-04-19', src: 'https://www.auctionreport.com/bid-now-rea-spring-2020-auction-in-progress-with-2900-lots-ends-april-19-2020/' },
  '2020 Summer': { close: '2020-08-16', src: 'wb:20200807100542/robertedwardauctions.com "Our Summer 2020 Auction is now open — Closes August 16"' },
  '2020 Fall': { close: '2020-12-06', src: 'wb:20201205184453/robertedwardauctions.com "Our Fall 2020 Auction is now open — Closes December 6"' },
  // the Pollard T206 standalone sale opened Thu Jan 21 2021 (Sports Collectors
  // Daily, captured 2021-01-23); its close was never posted → Q1 bound
  '2021 T206': { close: '2021-03-31', precision: 'season', src: 'wb:20210123131353/sportscollectorsdaily.com/finest-known-t206-set-hits-the-auction-block-card-by-card/ "Bidding opened Thursday" — close unpublished, quarter-end bound' },
  '2021 Spring': { close: '2021-04-18', src: 'wb:20210413020822/robertedwardauctions.com "Our Spring 2021 Auction is now open — Closes April 18"' },
  '2021 Summer': { close: '2021-08-15', src: 'wb:20210803051604/robertedwardauctions.com "Our Summer 2021 Auction is now open — Closes August 15"' },
  '2021 Fall': { close: '2021-12-05', src: 'wb:20211201183055/robertedwardauctions.com "Our Fall 2021 Auction is now open — Closes December 5"' },
  '2022 Spring': { close: '2022-04-24', src: 'wb:20220423092515/robertedwardauctions.com "Our Spring 2022 auction is now open — Ends April 24"' },
  '2022 Summer': { close: '2022-08-14', src: 'wb:20220809234104/robertedwardauctions.com "Auction Ends Aug 14"' },
  '2022 Fall': { close: '2022-12-04', src: 'https://www.psacard.com/articles/articleview/10742/robert-edward-auctions-fall-auction-headlined-by-assortment-rare-blockbuster-items-now-open-closes-dec-4; wb:20221202064928' },
  '2023 Spring': { close: '2023-04-23', src: 'wb:20230410171742/robertedwardauctions.com "Ends April 23."' },
  '2023 Summer': { close: '2023-08-13', src: 'wb:20230726105428/robertedwardauctions.com "Auction Ends August 13"' },
  '2023 Fall': { close: '2023-12-03', src: 'wb:20231128120419/robertedwardauctions.com "Our Fall Auction Is Open For Bidding! … Auction Ends December 3."' },
  '2024 Spring': { close: '2024-04-21', src: 'https://www.auctionreport.com/rea-spring-auction-of-cards-memorabilia-and-more-ends-april-21-2024/' },
  '2024 Summer': { close: '2024-08-11', src: 'https://www.auctionreport.com/rea-summer-auction-of-cards-memorabilia-and-more-ends-august-11-2024/' },
  '2024 Fall': { close: '2024-12-08', src: 'https://www.auctionreport.com/tag/robert-edward-auctions/ "REA Fall Catalog Auction … Ends Dec. 8, 2024"' },
  '2025 Spring': { close: '2025-04-27', src: 'wb:20250216190615/collectrea.com/about/schedule "April 11-27 – Spring Catalog Auction"' },
  '2025 Summer': { close: '2025-08-17', src: 'wb:20250216190615/collectrea.com/about/schedule "July 29 - August 17"; https://www.auctionreport.com/reas-summer-auction-in-progress-ends-august-17-2025/' },
  '2025 Fall': { close: '2025-12-07', src: 'wb:20250216190615/collectrea.com/about/schedule "November 21 - December 7 – Fall Catalog Auction"' },
  '2026 Spring': { close: '2026-04-19', src: 'https://collectrea.com/about/schedule "April 2-19 – Spring Catalog Auction"' },
  '2026 Summer': { close: '2026-08-16', src: 'https://collectrea.com/about/schedule "July 28 - August 16 – Summer Catalog Auction"' },
  '2026 Fall': { close: '2026-12-06', src: 'https://collectrea.com/about/schedule "November 20 - December 6 – Fall Catalog Auction"' },
  // ── REA monthly ("Encore") sales — 84k archive rows sat on the mid-month
  // stub (date-reaudit Oct 2026: 5/5 sampled REA monthly rows had the wrong
  // day). They close the third Sunday-ish of the label month; the stub was a
  // safe 'month' bound, these are the real days. Post headlines (AR) win over
  // the published schedule where both exist (Sep 2023: schedule 17, closed 24).
  '2021 February': { close: '2021-02-21', src: 'https://www.auctionreport.com/tag/robert-edward-auctions/ "REA Encore Auction In Progress with 1100+ Lots – Ends February 21, 2021"' },
  '2021 March': { close: '2021-03-21', src: 'https://www.auctionreport.com/rea-encore-auction-in-progress-with-2200-lots-ends-march-21-2021/' },
  '2021 May': { close: '2021-05-23', src: 'https://www.auctionreport.com/tag/robert-edward-auctions/ "REA Encore Auction In Progress with 2000+ Lots – Ends May 23, 2021"' },
  '2021 June': { close: '2021-06-20', src: 'https://www.auctionreport.com/rea-encore-auction-in-progress-with-1500-lots-ends-june-20-2021/' },
  '2021 September': { close: '2021-09-19', src: 'https://www.auctionreport.com/tag/robert-edward-auctions/ "REA Encore Auction In Progress with 1600+ Lots – Ends September 19, 2021"' },
  '2021 October': { close: '2021-10-24', src: 'https://www.auctionreport.com/tag/robert-edward-auctions/ "REA Encore Auction In Progress with 1900+ Lots – Ends October 24, 2021"' },
  '2022 January': { close: '2022-01-23', src: 'https://www.auctionreport.com/tag/robert-edward-auctions/ "REA Encore Auction In Progress with 1900+ Lots – Ends January 23, 2022"' },
  '2022 February': { close: '2022-02-20', src: 'https://www.auctionreport.com/tag/robert-edward-auctions/ "… with 1400+ Lots – Ends February 20, 2022"; wb:20220519174815/robertedwardauctions.com/about/schedule "February 10-20, 2022"' },
  '2022 March': { close: '2022-03-20', src: 'https://www.auctionreport.com/tag/robert-edward-auctions/ "… with 2600+ Lots – Ends March 20, 2022"' },
  '2022 May': { close: '2022-05-22', src: 'https://www.auctionreport.com/tag/robert-edward-auctions/ "… with 3000+ Lots – Ends May 22, 2022"' },
  '2022 June': { close: '2022-06-19', src: 'https://www.auctionreport.com/rea-encore-auction-in-progress-with-3000-lots-ends-june-19-2022/' },
  '2022 September': { close: '2022-09-18', src: 'https://www.auctionreport.com/tag/robert-edward-auctions/ "REA Encore Auction In Progress – Ends September 18, 2022"; wb:20221206231421 schedule "September 8-18, 2022"' },
  '2022 October': { close: '2022-10-23', src: 'https://www.auctionreport.com/rea-encore-auction-in-progress-with-4200-lots-ends-october-23-2022/' },
  '2022 November': { close: '2022-11-13', src: 'wb:20221206231421/robertedwardauctions.com/about/schedule "November 3-13, 2022"' },
  '2023 January': { close: '2023-01-22', src: 'https://www.auctionreport.com/tag/encore-auction/ "REA Encore Auction with 3000+ Lots – Ends January 22, 2023"' },
  '2023 February': { close: '2023-02-19', src: 'https://www.auctionreport.com/tag/encore-auction/ "REA Encore Auction with 2500+ Lots – Ends February 19, 2023"' },
  '2023 March': { close: '2023-03-19', src: 'https://www.auctionreport.com/tag/encore-auction/ "REA Encore Auction of Cards, Memorabilia and More Ends March 19, 2023"' },
  '2023 May': { close: '2023-05-21', src: 'wb:20230129004921/robertedwardauctions.com/about/schedule "May 11-21 – May Encore Auction"' },
  '2023 June': { close: '2023-06-18', src: 'https://www.auctionreport.com/tag/encore-auction/ "REA Encore Auction of Cards, Memorabilia and More Ends June 18, 2023"' },
  '2023 September': { close: '2023-09-24', src: 'https://www.auctionreport.com/tag/encore-auction/ "REA Encore Auction of Cards, Memorabilia and More Ends September 24, 2023"' },
  '2023 October': { close: '2023-10-22', src: 'wb:20230129004921/robertedwardauctions.com/about/schedule "October 12-22 – October Encore Auction"' },
  '2024 January': { close: '2024-01-21', src: 'wb:20240101135040/robertedwardauctions.com/about/schedule "January 11-21 – January Encore Auction"' },
  '2024 February': { close: '2024-02-18', src: 'wb:20240101135040/robertedwardauctions.com/about/schedule "February 8-18 – February Encore Auction"' },
  '2024 March': { close: '2024-03-24', src: 'wb:20240101135040/robertedwardauctions.com/about/schedule "March 14-24 – March Encore Auction"' },
  '2024 May': { close: '2024-05-19', src: 'https://www.auctionreport.com/reas-encore-auction-offers-3600-lots-ending-may-19-2024/' },
  '2024 June': { close: '2024-06-23', src: 'wb:20240101135040/robertedwardauctions.com/about/schedule "June 13-23 – June Encore Auction"' },
  '2024 September': { close: '2024-09-22', src: 'wb:20240101135040/robertedwardauctions.com/about/schedule "September 12-22 – September Encore Auction"' },
  '2024 October': { close: '2024-10-20', src: 'wb:20240101135040/robertedwardauctions.com/about/schedule "October 10-20 – October Encore Auction"' },
  '2024 November': { close: '2024-11-17', src: 'https://www.auctionreport.com/reas-encore-auction-offers-3200-lots-ending-november-17-2024/' },
  '2025 January': { close: '2025-01-19', src: 'https://www.auctionreport.com/reas-encore-auction-offers-3000-lots-ending-january-19-2025/' },
  '2025 February': { close: '2025-02-23', src: 'wb:20250216190615/collectrea.com/about/schedule "February 13-23 – February Auction"' },
  '2025 March': { close: '2025-03-23', src: 'wb:20250216190615/collectrea.com/about/schedule "March 13-23 – March Auction"' },
  '2025 May': { close: '2025-05-18', src: 'wb:20250216190615/collectrea.com/about/schedule "May 8-18 – May Auction"' },
  '2025 June': { close: '2025-06-22', src: 'wb:20250216190615/collectrea.com/about/schedule "June 12-22 – June Auction"' },
  '2025 September': { close: '2025-09-21', src: 'wb:20250216190615/collectrea.com/about/schedule "September 11-21 – September Auction"' },
  '2025 October': { close: '2025-10-19', src: 'wb:20250216190615/collectrea.com/about/schedule "October 9-19 – October Auction"' },
  '2026 January': { close: '2026-01-18', src: 'https://collectrea.com/about/schedule "January 8-18 – January Auction"' },
  '2026 February': { close: '2026-02-22', src: 'https://collectrea.com/about/schedule "February 12-22 – February Auction"' },
  '2026 March': { close: '2026-03-22', src: 'https://collectrea.com/about/schedule "March 12-22 – March Auction"' },
  '2026 May': { close: '2026-05-17', src: 'https://collectrea.com/about/schedule "May 7-17 – May Auction"' },
  '2026 June': { close: '2026-06-21', src: 'https://collectrea.com/about/schedule "June 11-21 – June Auction"' },
  '2026 September': { close: '2026-09-20', src: 'https://collectrea.com/about/schedule "September 10-20 – September Auction"' },
  '2026 October': { close: '2026-10-18', src: 'https://collectrea.com/about/schedule "October 8-18 – October Auction"' },
};

/* ── Huggins & Scott — EVERY sale label in the corpus (the month labels are
   NOT the close month: "2008 June" closed July 10, "2022 February" April 7).
   Two-night closes (lots 1-N one night, the rest the next) take the LAST. ── */
const HS: Record<string, Row> = {
  '2005 September': { close: '2005-09-29', src: 'wb:20050830015054/hugginsandscott.com "September 28th & 29th Masterpiece Auction"' },
  '2006 March': { close: '2006-03-16', src: 'wb:20060204051246/hugginsandscott.com "NEXT AUCTION DATE: MARCH 15th & 16th, 2006"' },
  '2006 September': { close: '2006-10-05', src: 'wb:20060719191012/hugginsandscott.com "next World Wide Internet Auction scheduled for October 4th and 5th, 2006" (results page "Oct 06")' },
  '2007 March': { close: '2007-03-08', src: 'wb:20070301212527/hugginsandscott.com "AUCTION HAS BEGUN! AUCTION ENDS: MARCH 7 & 8, 2007"' },
  '2007 October': { close: '2007-10-11', src: 'wb:20070528225706/hugginsandscott.com "Next Auction Ends: October 10 & 11, 2007"' },
  '2008 April': { close: '2008-04-03', src: `${AR_HS} "auction that begins March 17 and ends April 2 and 3"` },
  '2008 June': { close: '2008-07-10', src: `${AR_HS} "Summer 2008 Masterpiece Auction … bidding ending this week on July 9-10"` },
  '2008 October': { close: '2008-10-23', src: 'https://www.auctionreport.com/huggins-and-scott-auctions-last-day-to-bid/ "The auction closes tonight, October 23, 2008."' },
  '2009 February': { close: '2009-02-05', src: `${AR_HS} "runs through February 4 & 5, 2009"` },
  '2009 May': { close: '2009-05-28', src: `${AR_HS} "Ends on May 27th and 28th, 2009"` },
  '2009 October': { close: '2009-10-01', src: `${AR_HS} "Fall Auction of 1555 lots begins closing tonight (Wednesday) September 30th" (lots 766+ the next night)` },
  '2009 December': { close: '2009-12-10', src: `${AR_HS} "December Catalog And Internet Auction Ends December 9th And 10th"` },
  '2010 March': { close: '2010-03-25', src: `${AR_HS} "Auction Ends Today March 24th and Tomorrow March 25th"` },
  '2010 May': { close: '2010-05-27', src: `${AR_HS} "Spring 2010 Masterpiece Auction Closes Today May 27"` },
  '2010 July': { close: '2010-07-29', src: `${AR_HS} "July 29, 2010 Auction is in its last day to bid"` },
  '2010 September': { close: '2010-09-30', src: `${AR_HS} "September 29-30th Auction – Last Days To Bid"` },
  '2010 November': { close: '2010-12-02', src: `${AR_HS} "current November 2010 worldwide Internet auction … December 1-2, 2010"` },
  '2011 January': { close: '2011-01-27', src: `${AR_HS} "January 2011 Masterpiece auction concluded on Thursday January 27th"` },
  '2011 March': { close: '2011-03-31', src: `${AR_HS} "March 2011 Masterpiece Auction … Ends March 30-31, 2011"` },
  '2011 May': { close: '2011-06-02', src: `${AR_HS} "June 1-2, 2011 Auction" (the corpus "2011 May" sale; next is July 28)` },
  '2011 July': { close: '2011-07-28', src: `${AR_HS} "Current Auction Ends Today July 28, 2011"` },
  '2011 September': { close: '2011-09-29', src: `${AR_HS} "ends on September 28/29, 2011"` },
  '2011 November': { close: '2011-12-01', src: `${AR_HS} "final Masterpiece Auction of 2011 begins on Monday November 21st … until Thursday night December 1st"` },
  '2012 January': { close: '2012-02-02', src: `${AR_HS} "January 2012 Masterpiece Auction … Current Auction Ends Feb. 2, 2012"` },
  '2012 March': { close: '2012-04-05', src: `${AR_HS} "March 2012 Masterpiece Auction" / "April 5, 2012 Masterpiece Auction … Ends Today"` },
  '2012 May': { close: '2012-06-07', src: `${AR_HS} "third Masterpiece Auction of 2012 ends today, Thursday night June 7, 2012"` },
  '2012 July': { close: '2012-08-09', src: `${AR_HS} "Fourth 2012 Masterpiece Auction … ending THURSDAY NIGHT AUGUST 9th"` },
  '2012 September': { close: '2012-10-11', src: `${AR_HS} "current October 2012 Masterpiece Auction … Ends October 11th" (fifth 2012 sale)` },
  '2012 November': { close: '2012-12-13', src: `${AR_HS} "final Masterpiece Auction of 2012, closes today, December 13, 2012"` },
  '2013 February': { close: '2013-02-07', src: `${AR_HS} "February 2013 Masterpiece Auction … Ends Tonight Feb. 7th"` },
  '2013 April': { close: '2013-04-11', src: `${AR_HS} "April 2013 Auction Ends Today April 11th"` },
  '2013 June': { close: '2013-06-13', src: `${AR_HS} "third Masterpiece Auction of 2013 … closes TODAY, Thursday night June 13th"` },
  '2013 August': { close: '2013-08-08', src: `${AR_HS} "August 2013 Masterpiece Auction … Thursday night, August 8th"` },
  '2013 October': { close: '2013-10-10', src: `${AR_HS} "fifth Masterpiece Auction of 2013 … closing on Thursday night October 10th"` },
  '2013 December': { close: '2013-12-12', src: `${AR_HS} "sixth and final Masterpiece Auction of 2013 … closing on Thursday night, December 12th"` },
  '2014 February': { close: '2014-02-13', src: `${AR_HS} "first Masterpiece Auction of 2014 … closing on Thursday night February 13th"` },
  '2014 April': { close: '2014-04-10', src: `${AR_HS} "second Masterpiece Auction of 2014 … closing on Thursday night April 10th"` },
  '2014 June': { close: '2014-06-12', src: `${AR_HS} "third Masterpiece Auction of 2014 … Thursday night June 12th"` },
  '2014 August': { close: '2014-08-07', src: `${AR_HS} "fourth Masterpiece Auction of 2014 … closing on Thursday night August 7th"` },
  '2014 October': { close: '2014-10-09', src: `${AR_HS} "fifth Masterpiece Auction of 2014 … closing on Thursday night October 9th"` },
  '2014 December': { close: '2014-12-11', src: `${AR_HS} "sixth Masterpiece Auction of 2014 closes Thursday night, December 11th"` },
  '2015 February': { close: '2015-02-12', src: `${AR_HS} "first Masterpiece Auction of 2015 … closing on Thursday night February 12th"` },
  '2015 April': { close: '2015-04-09', src: `${AR_HS} "second Masterpiece Auction of 2015 … close on Thursday night April 9th"` },
  '2015 June': { close: '2015-06-11', src: `${AR_HS} "third Masterpiece Auction of 2015 … close on Thursday night June 11th"` },
  '2015 August': { close: '2015-08-06', src: `${AR_HS} "fourth Masterpiece Auction of 2015 closes on Thursday night August 6th"` },
  '2015 November': { close: '2015-11-12', src: `${AR_HS} "final Masterpiece Auction of 2015 … close on Thursday night November 12th"` },
  '2016 February': { close: '2016-02-11', src: `${AR_HS} "first of four Masterpiece Auctions of 2016 … closes on Thursday night February 11th"` },
  '2016 May': { close: '2016-05-19', src: `${AR_HS} "second of four Masterpiece Auctions of 2016 … closes on Thursday night, May 19, 2016"` },
  '2016 August': { close: '2016-08-11', src: `${AR_HS} "2016 Event of the Year, the August Auction … close on Thursday night August 11th"` },
  '2016 November': { close: '2016-11-10', src: `${AR_HS} "final auction of 2016, the November Auction … closes on Thursday night November 10th"` },
  '2017 February': { close: '2017-02-09', src: `${AR_HS} "first auction of 2017, the February Auction … close on Thursday night February 9th"` },
  '2017 May': { close: '2017-05-04', src: `${AR_HS} "second auction of 2017, the May Auction … closes on Thursday night May 4, 2017"` },
  '2017 August': { close: '2017-08-03', src: `${AR_HS} "the August 2017 Masterpiece Auction … Ends August 3, 2017"` },
  '2017 November': { close: '2017-11-09', src: `${AR_HS} "Final Auction of 2017 Closes November 9, 2017"` },
  '2018 February': { close: '2018-02-08', src: `${AR_HS} "first auction of 2018 … will close on Thursday night February 8th"` },
  '2018 May': { close: '2018-05-10', src: `${AR_HS} "May 2018 Auction … bidding ending on Thursday night, May 10, 2018"` },
  '2018 August': { close: '2018-08-09', src: `${AR_HS} "August 2018 Auction … bidding ending on Thursday night, August 9, 2018"` },
  '2018 September': { close: '2018-09-16', src: `${AR_HS} "September Monthly Auction In Progress – Concludes on Sept. 16, 2018"` },
  '2018 November': { close: '2018-11-15', src: `${AR_HS} "Fall 2018 premier auction … will conclude on November 15, 2018"` },
  '2018 December': { close: '2018-12-16', src: `${AR_HS} "December Monthly Auction In Progress – Concludes on Dec. 16, 2018"` },
  '2019 February': { close: '2019-02-13', src: `${AR_HS} "first auction of 2019 … closes on Wednesday night, February 13, 2019"` },
  '2019 March': { close: '2019-03-24', src: `${AR_HS} "March 2019 Monthly Auction In Progress – Concludes on March 24, 2019"` },
  '2019 May': { close: '2019-05-09', src: `${AR_HS} "May 2019 Auction In Progress – Concludes on May 9, 2019"` },
  '2019 August': { close: '2019-08-08', src: `${AR_HS} "Auction In Progress – Ends August 8, 2019"` },
  '2019 November': { close: '2019-11-14', src: `${AR_HS} "Auction In Progress – Ends November 14, 2019"` },
  '2020 February': { close: '2020-02-20', src: `${AR_HS} "Auction In Progress – Ends February 20, 2020"` },
  '2020 May': { close: '2020-05-28', src: `${AR_HS} "Auction In Progress – Ends May 28, 2020"` },
  '2020 October': { close: '2020-10-22', src: `${AR_HS} "Auction In Progress – Ends October 22, 2020"` },
  '2021 February': { close: '2021-03-11', src: `${AR_HS} "Feb.-March 2021 offering runs February 26 – March 11, 2021"` },
  '2021 August': { close: '2021-08-05', src: `${AR_HS} "Summer 2021 auction … concludes on August 5, 2021"` },
  '2021 November': { close: '2021-12-16', src: `${AR_HS} "Fall 2021 auction … concludes on December 16, 2021"` },
  '2022 February': { close: '2022-04-07', src: `${AR_HS} "Spring 2022 auction … concludes on April 7, 2022"` },
  '2022 August': { close: '2022-08-04', src: `${AR_HS} "Summer 2022 auction … concludes on August 4, 2022"` },
  '2022 November': { close: '2022-12-08', src: `${AR_HS} "Fall 2022 auction … concludes on December 8, 2022"` },
  // lot 1 = "Babe Ruth boldly signed Spalding star baseball": the Spring 2023
  // sale ("led by 1952 Topps Mantle and Ruth Signed Baseball")
  '2023 February': { close: '2023-04-06', src: `${AR_HS} "Spring 2023 auction … concludes on April 6, 2023"` },
  '2023 August': { close: '2023-08-03', src: `${AR_HS} "Summer Masterpiece Auction … runs today through August 3, 2023"` },
  '2023 Fall': { close: '2023-12-07', src: `${AR_HS} "Fall Catalog Auction, which runs through December 7, 2023"` },
  '2024 Spring': { close: '2024-04-04', src: 'https://www.auctionreport.com/huggins-scott-spring-auction-ends-april-4-2024/' },
  '2024 Summer': { close: '2024-08-01', src: 'https://www.auctionreport.com/huggins-scott-summer-auction-ends-august-1-2024/' },
  // AR headlines it "Winter" — same sale (lot 1 = the 1912 Fenway Opening Day stub)
  '2024 Fall': { close: '2024-12-05', src: 'https://www.auctionreport.com/huggins-scott-winter-auction-ends-december-5-2024/' },
  '2025 Winter': { close: '2025-02-27', src: `${AR_HS} "Huggins & Scott Winter Auction Ends February 27, 2025"` },
  '2025 May': { close: '2025-05-29', src: `${AR_HS} "Spring Auction of 1,600+ Items Ends May 29, 2025"` },
  '2025 Summer': { close: '2025-09-04', src: `${AR_HS} "Summer Auction of 1,900+ Items Ends September 4, 2025"` },
  '2025 Fall': { close: '2025-12-04', src: `${AR_HS} "Fall Auction of 1,800+ Items Ends December 4, 2025"` },
  '2026 Winter': { close: '2026-02-26', src: `${AR_HS} "Winter Auction of 1,500+ Items Ends February 26, 2026"` },
  '2026 Spring': { close: '2026-05-28', src: `${AR_HS} "Spring Auction Ending May 28, 2026"` },
  '2026 Summer': { close: '2026-09-10', src: `${AR_HS} "Huggins & Scott Sept. 10th Summer Auction" (= the live bid-page endTimes)` },
};

export const SALE_CLOSE_DATES: Readonly<Record<'REA' | 'Huggins & Scott', Readonly<Record<string, Row>>>> = { REA, 'Huggins & Scott': HS };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SEASON_END: Record<string, string> = { winter: '03-31', spring: '06-30', summer: '09-30', fall: '12-31', autumn: '12-31' };

/** "2019 Summer" / "Summer 2019" / "2022 february" → { year, word } (word lower-case) */
export function parseSaleLabel(label: string): { year: string; word: string } | null {
  const y = label.match(/\b((?:19|20)\d{2})\b/);
  if (!y) return null;
  const w = label.replace(y[0], ' ').match(/[A-Za-z0-9]+/);
  return w ? { year: y[1], word: w[0].toLowerCase() } : null;
}

/** last day of 1-based month `month1` (13+ rolls into the next year) */
const lastDayOf = (year: number, month1: number): string => {
  const d = new Date(Date.UTC(year, month1, 0)); // day 0 of month1+1 (0-based month1)
  return d.toISOString().slice(0, 10);
};

/**
 * The close day of an REA / H&S sale from its archive label, or null when the
 * old month stub is already a safe bound (REA monthly sales) / the house or
 * label is not one this table covers.
 */
export function saleCloseFor(house: string, label: string | null | undefined, asOf?: string): { date: string; precision: ClosePrecision; src: string } | null {
  if (label && GALLERY_HOUSES.has(house)) return galleryCloseFor(house, label, asOf);
  if (!label || (house !== 'REA' && house !== 'Huggins & Scott')) return null;
  const p = parseSaleLabel(label);
  if (!p) return null;
  const key = `${p.year} ${p.word.charAt(0).toUpperCase()}${p.word.slice(1)}`;
  const clamp = (d: string) => (asOf && d > asOf ? asOf : d);
  const row = SALE_CLOSE_DATES[house][key];
  if (row) return { date: clamp(row.close), precision: row.precision ?? 'day', src: row.src };
  const se = SEASON_END[p.word];
  if (se) return { date: clamp(`${p.year}-${se}`), precision: 'season', src: 'fallback: end of the season quarter' };
  const mi = MONTHS.indexOf(p.word);
  if (house === 'Huggins & Scott' && mi >= 0) return { date: clamp(lastDayOf(+p.year, mi + 3)), precision: 'season', src: 'fallback: H&S month label → end of the month two after it' };
  return null;
}

/* ── Lelands / Love of the Game / Memory Lane (one gallery engine) ─────────
   The gallery crawler (crawl-lelands-gallery.ts) dated every sold lot by its
   Gallery-dropdown auction name through seasonToDate's mid-month stub and
   stored NO saleName — ~41k rows on a 15th, 'month' precision. Unlike REA's
   monthly sales those stubs are NOT a safe bound: LOTG "Fall, 2023 Premier"
   → Oct 15 closed Nov 25; Lelands "2019 Spring Classic" → Apr 15 closed Jun 7;
   LOTG "2016 Ringside" (no season word → June) closed Nov 26; ML "The Find
   Winter 2012" → Feb 15 closed Dec 15 (date re-audit Oct 2026: 7 of 7
   checkable stub rows wrong). Keyed by the dropdown label EXACTLY as the house
   prints it (Wayback captures of /Lots/Gallery, cited in each null row).
   Every label that carries a year is listed — the crawler never dated a
   year-less one — with close null where no source was found, so a stub that
   several labels share is resolved only when every one of them is known.
   AR = auctionreport.com post headline (a headline that omits the year is
   placed by the post's position in the house's feed, and the weekday is
   checked against the house's close night).
   ── */
type GalleryRow = { close: string | null; src: string };

const LOTG: Record<string, GalleryRow> = {
  'Spring, 2026 Premier Auction': { close: '2026-04-11', src: 'https://www.auctionreport.com/love-of-the-game-spring-auction-ends-april-11-2026/' },
  'Fall, 2025 Premier Auction': { close: '2025-11-29', src: 'dropdown "Fall, 2025 Premier Auction - Closes Nov. 29, 2025"; https://www.auctionreport.com/love-of-the-game-fall-auction-ends-november-29-2025/' },
  'Summer, 2025 Premier Auction': { close: '2025-08-09', src: 'dropdown "Summer, 2025 Premier Auction - Closes August 9"; AR "Love of the Game Summer Auction Ends August 9, 2025"' },
  'Spring, 2025 Premier Auction': { close: '2025-04-05', src: 'dropdown "… - Closes April 5"; https://www.auctionreport.com/love-of-the-game-auctions-spring-premiere-auction-ends-april-5-2025/' },
  'Fall, 2024 Premier Auction': { close: '2024-11-30', src: 'AR "Love of the Game Auctions Fall Premiere Auction Ends Nov. 30, 2024"' },
  'Summer, 2024 Premier Auction': { close: '2024-09-28', src: 'https://www.auctionreport.com/love-of-the-game-auctions-summer-premiere-2024-auction-ends-september-28-2024/' },
  'Summer 2024 Set Builder Auction': { close: '2024-07-13', src: 'AR "Love of the Game Auctions Set Builder Auction Ends July 13, 2024"' },
  'Spring, 2024 Premier Auction': { close: '2024-03-30', src: 'AR "Love of the Game Auctions Current Auction Ends March 30, 2024" (the only LOTG close between Fall 2023 and the July Set Builder)' },
  'Fall, 2023 Premier Auction': { close: '2023-11-25', src: 'AR "Love of the Game Auctions Fall Premier Auction Ends November 25, 2023"' },
  'Summer, 2023 Premier Auction': { close: '2023-08-19', src: 'AR "Love of the Game Auctions Summer Premier Auction Ends August 19, 2023"' },
  'Spring, 2023 Premier Auction': { close: '2023-04-29', src: 'https://www.auctionreport.com/love-of-the-game-auctions-spring-premier-auction-ends-april-29-2023/' },
  'Fall, 2022 - 10th Anniversary Auction': { close: '2022-11-26', src: 'https://www.auctionreport.com/love-of-the-game-auctions-10th-anniversary-premier-auction-ends-november-26-2022/' },
  'Summer, 2022 Premier Auction': { close: '2022-08-20', src: 'https://www.auctionreport.com/love-of-the-game-auctions-summer-auction-ends-august-20-2022/' },
  'Winter, 2023 Set Builder Auction': { close: '2023-02-11', src: 'AR "Love of the Game Auctions Set Builder Auction Ends February 11, 2023"' },
  'Spring, 2022 Premier Auction': { close: '2022-04-02', src: 'https://www.psacard.com/articles/articleview/10627/love-game-spring-2022-auction-now-underway-premier-catalog-closes-april-2' },
  'Fall, 2021 Premier Auction': { close: '2021-11-27', src: 'https://www.auctionreport.com/love-of-the-games-fall-auction-bidding-ends-november-27-2021/' },
  'Summer, 2021 Premier Auction': { close: '2021-08-28', src: 'AR "Love of the Games Summer Auction – Bidding Ends August 28, 2021"' },
  'June, 2021 Extra Innings': { close: '2021-06-26', src: 'AR "Love of the Game Auctions T206 Extra Innings Auction Ends June 26, 2021"' },
  'Spring, 2021 Auction': { close: '2021-04-03', src: 'AR "Great Cards & Memorabilia at Love of the Game Auctions – Ends April 3, 2021" (a sibling post prints April 2; the Saturday close is the later day)' },
  'Fall, 2020 Auction': { close: '2020-11-28', src: 'AR "Love of the Game Auctions Fall 2020 Premier Auction Ends November 28, 2020"' },
  'Summer, 2020 Auction': { close: '2020-08-29', src: 'AR "Love of the Game Summer 2020 Auction In Progress – Ends August 29, 2020"' },
  'Spring 2020 Premier Auction': { close: '2020-04-11', src: 'AR "Love of the Game Spring 2020 Auction In Progress – Ends April 11, 2020"' },
  'Fall, 2019 Premier Auction': { close: '2019-11-30', src: 'https://www.auctionreport.com/love-of-the-game-auctions-fall-auction-in-progress-ends-november-30-2019/' },
  'Summer, 2019 Premier Auction': { close: '2019-08-24', src: 'https://www.auctionreport.com/love-of-the-game-auctions-summer-sale-july-31-august-24-2019/' },
  'Spring, 2019 Premier Auction': { close: '2019-04-13', src: 'https://www.auctionreport.com/bid-in-love-of-the-game-auctions-april-13-2019-auction/' },
  'Fall, 2018 Premier Auction': { close: '2018-11-24', src: 'AR "Love of the Game Auctions Fall 2018 Premier Auction In Progress – Ends November 24, 2018"' },
  'Summer, 2018 Auction': { close: '2018-08-11', src: 'AR "Love of the Game Auctions Summer 2018 Premier Auction In Progress – Ends August 11, 2018"' },
  'Spring, 2018 Auction': { close: '2018-03-24', src: 'https://www.auctionreport.com/love-of-the-game-auctions-spring-2018-premier-auction-ends-march-24-2018/' },
  'Fall, 2017 Ringside and Premier Auction': { close: '2017-11-25', src: 'https://www.auctionreport.com/open-for-bidding-love-of-the-game-auctions-fall-2017-auction-ends-november-24-25-2017/ (two-night close, the last)' },
  'Spring, 2017 Premier Auction': { close: '2017-04-01', src: 'https://www.auctionreport.com/bid-love-of-the-game-auctions-april-1-2017-spring-premier-auction/' },
  '2016 Ringside Auction': { close: '2016-11-26', src: 'https://www.auctionreport.com/love-of-the-game-auctions-ring-side-auction-ends-november-26-2016/' },
  'Fall, 2016 Premier Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20260402054230/bid.loveofthegameauctions.com/Lots/Gallery); close not found' },
  'Summer, 2016 Set Builder\'s Auction': { close: '2016-10-01', src: 'https://www.auctionreport.com/bid-now-in-love-of-the-games-set-builders-auction-ends-october-1-2016/' },
  'Spring, 2016 Premier Auction': { close: '2016-06-11', src: 'https://www.auctionreport.com/love-of-the-game-auctions-launches-spring-auction-this-week-ends-june-11-2016/' },
  'Winter, 2015 Set Builder\'s Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20260402054230/bid.loveofthegameauctions.com/Lots/Gallery); close not found' },
  'Winter, 2016 Premier Auction': { close: '2016-01-30', src: 'AR "Open for Bidding: Love of the Game Winter Premier Auction Ends January 30th" (Sat Jan 30 2016)' },
  'Summer, 2015 Premier Auction': { close: '2015-08-08', src: 'AR "Love of the Game Summer Auction Open – Ends August 8th" (Sat Aug 8 2015)' },
  'Spring, 2015 Set Builder\'s Auction': { close: '2015-05-30', src: 'AR "Love of the Game Auctions Summer Set Builder\'s Auction In Progress – Ends May 30" (Sat May 30 2015)' },
  'Spring, 2015 Premier Catalog Auction': { close: '2015-03-28', src: 'AR "Historically Significant Items at Love of the Game Auction – Ends March 28th" (Sat Mar 28 2015)' },
  'Fall, 2014 Premier Auction': { close: '2014-11-01', src: 'AR "The Love of the Game Fall Premier Auction In Progress – Ends Nov. 1st" (Sat Nov 1 2014)' },
  'Love of the Game Spring, 2014 Auction': { close: '2014-05-31', src: 'https://sportscollectorsdigest.com/auctions/lotg-auction-features-stellar-cracker-jack-mathewson-and-the-fastest-baseballs-ever-thrown ("The auction closing date is May 31", May 15 2014)' },
  'Winter, 2014 Auction': { close: '2014-02-01', src: 'AR "Love of the Games Winter Auction Now Open – Bidding Closes Feb. 1st" (Sat Feb 1 2014)' },
  'Fall, 2013 Auction': { close: '2013-11-16', src: 'AR "Open for Bidding: Love of the Game Auctions In Progress – Closes Nov. 16th" (Sat Nov 16 2013)' },
  'Summer, 2013 Auction': { close: '2013-08-24', src: 'AR "Love of the Game Summer Auction Closes Saturday Aug. 24th"' },
  'Love of the Game Opening Day, 2013 Auction': { close: '2013-04-06', src: 'AR "Love of the Game Opening Day Auction – Closing Saturday April 6th"' },
  'Love of the Game February 2, 2013 Auction': { close: '2013-02-02', src: 'the label is the close ("Love of The Game Auctions Winter 2013 Auction Ends Feb. 2nd")' },
};

const LELANDS: Record<string, GalleryRow> = {
  '2026 Summer Classic': { close: '2026-08-15', src: 'AR "Lelands Classic Auction Ends August 15, 2026"' },
  '2026 Winter Pop-Up': { close: '2026-01-25', src: 'AR "Lelands Pop-Up Auction – Bidding In Progress and Ends January 25, 2026"' },
  '2026 Spring Classic': { close: '2026-04-18', src: 'AR "Bid Now! Auctions Closing Today, April 18, 2026 – Lelands, …"' },
  '2025 Fall Pop-Up': { close: '2025-10-05', src: 'AR "Lelands Pop-Up Auction – Bidding In Progress and Ends October 5, 2025"' },
  '2025 Fall Classic': { close: '2025-12-06', src: 'AR "Lelands Classic Auction Ends December 6, 2025"' },
  '2025 Summer Classic': { close: '2025-08-16', src: 'AR "Lelands Summer Classic Auction Ends August 16, 2025"' },
  '2025 Spring Pop-Up': { close: '2025-05-18', src: 'AR "Lelands Pop-Up Auction – Bidding In Progress and Ends May 18, 2025"' },
  '2025 Winter Classic': { close: '2025-03-15', src: 'AR "Lelands Winter Classic Auction In Progress – Ends March 15, 2025"' },
  '2024 Fall Pop-Up': { close: '2024-11-17', src: 'AR "Lelands Pop-Up Auction – Bidding In Progress and Ends November 17, 2024"' },
  '2024 Fall Classic': { close: '2024-10-19', src: 'AR "Lelands Fall Classic Auction In Progress and Ends October 19, 2024"' },
  '2024 Summer Classic': { close: '2024-06-29', src: 'AR "Lelands Classic Auction Featuring Cards, Game Worn and More Ends June 29, 2024"' },
  '2024 Spring Pop-Up': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  '2024 Winter Classic': { close: '2024-03-16', src: 'AR "Lelands Classic Auction Featuring Cards, Game Worn and More Ends March 16, 2024"' },
  '2024 Winter Pop-Up': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  '2023 Fall Classic': { close: '2023-11-18', src: 'AR "The Lelands Classic Auction Featuring Ruth … Ends Nov. 18, 2023"' },
  '2023 Fall Access': { close: '2023-10-01', src: 'AR "Lelands Fall Access Auction Ends October 1, 2023"' },
  'Spring Focus 2023': { close: '2023-06-03', src: 'AR "Lelands Focus Auction Features 40+ Extraordinary Rare Items Ending June 3, 2023"' },
  '2023 Summer Classic': { close: '2023-08-05', src: 'AR "The Lelands Summer Classic Auction Ends August 5, 2023"' },
  '2023 Summer Pop-Up': { close: '2023-06-25', src: 'AR "Lelands Pop-Up Auction – Bidding Ends June 25, 2023"' },
  'Winter Focus 2023': { close: '2023-02-11', src: 'AR "Lelands Focus Auction Features 40+ Extraordinary Rare Items Ends Feb. 11, 2023"' },
  '2023 Spring Classic': { close: '2023-04-22', src: 'AR "The Lelands Spring Classic Auction Ends April 22, 2023"' },
  '2023 Winter Pop-Up': { close: '2023-01-22', src: 'AR "The Adventure Begins: Lelands Winter Pop Up Auction Ends Jan. 22, 2023"' },
  'Fall Classic 2022': { close: '2022-12-10', src: 'AR "The Lelands Fall Classic Auction Ends December 10, 2022"' },
  'Summer Classic 2022': { close: '2022-09-17', src: 'AR "The Lelands Summer Classic Auction Ends September 17, 2022"' },
  'Spring Classic 2022': { close: '2022-06-11', src: 'AR "The Lelands Spring Classic Auction Ends June 11, 2022"' },
  'Winter Classic 2022': { close: '2022-03-12', src: 'AR "The Lelands Winter Classic Auction In Progress – Ends March 12, 2022"' },
  'Late Fall Classic 2021': { close: '2021-12-11', src: 'AR "The Lelands Fall Classic Auction In Progress – Ends December 11, 2021"' },
  '2022 Winter Pop-Up': { close: '2022-02-12', src: 'AR "Lelands Pop-Up Auction LIVE – Bidding Ends February 12, 2022"' },
  'Late Summer Classic 2021': { close: '2021-09-25', src: 'AR "The Lelands Summer Classic Auction In Progress – Ends September 25, 2021"' },
  'Mid-Spring Classic 2021': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Spring Classic 2021': { close: '2021-04-02', src: 'AR "The Lelands Spring Classic Auction In Progress – Ends April 2, 2021"' },
  '2021 Summer Kickoff Pop-Up': { close: '2021-06-27', src: 'AR "Lelands Pop-Up Auction LIVE – Bidding Ends June 27, 2021"' },
  '2021 Winter Pop-Up': { close: '2021-02-07', src: 'AR "Lelands Pop-Up Auction LIVE – Bidding Ends February 7, 2021"' },
  '2020 Fall Pop-Up': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Summer 2020 Pop Up': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  '2020 Fall Classic': { close: '2020-12-11', src: 'AR "Lelands 2020 Fall Auction Now Open – Ends December 11, 2020"' },
  'Spring 2020 Pop-Up': { close: '2020-04-26', src: 'AR "Lelands Pop-Up Auction LIVE – Bidding Ends April 26, 2020"' },
  '2020 Winter Pop-Up Auction': { close: '2020-03-01', src: 'AR "Lelands Pop-Up Auction Is LIVE – Ends March 1, 2020"' },
  'Spring Classic 2020': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  '2019 Fall Classic': { close: '2019-12-06', src: 'AR "Lelands Fall Classic Auction Is On – Ends December 6, 2019"' },
  '2019 Spring Classic': { close: '2019-06-07', src: 'AR "The Lelands 2019 Spring Classic Auction In Progress – Closes June 7, 2019"' },
  '2019 Winter Classic': { close: '2019-02-01', src: 'AR "Lelands Winter Classic Auction … In Progress – Ends February 1, 2019"' },
  '2018 Invitational': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Fall 2016': { close: '2016-10-28', src: 'AR "Lelands.com The Greatest Auction In Progress – Ends October 28, 2016" (the only fall-2016 Lelands close)' },
  'Summer 2016 Catalog': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Winter 2015 Catalog Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Summer 2015 Catalog Auction': { close: '2015-07-17', src: 'AR "Lelands.com Summer Auction Featuring Vintage Sports, Horse Racing and More Ends July 17th" (Fri Jul 17 2015; Lelands catalogs close Fridays)' },
  'Fall 2014': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Spring 2014 Catalog Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Fall 2013 Catalog Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Spring 2013 Catalog Auction': { close: '2013-06-28', src: 'AR "Lelands: Lou Gehrig Late 1920\'s Game Used Bat & More – Ends 6/28/13"' },
  'Fall 2012 Catalog Auction': { close: '2012-12-21', src: 'AR "Leland\'s Fall 2012 Auction In Progress – Ending Dec. 21st"' },
  'Spring 2012 Catalog Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'December 2011 Catalog': { close: '2011-12-16', src: 'AR "Lelands Fall Auction Ends Today Dec. 16th" (Fri Dec 16 2011)' },
  'June 2011 Catalog': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'November 2010 Catalog': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'June 2010 Catalog': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'November 2009 Catalog': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'June 2009 Catalogue': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'November 2008 Catalogue': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'June 2008 Internet Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'May 2008 Catalog': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'May 2008 Internet Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'March 2008 Internet': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'February 2008 Internet': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'January 2008 Internet': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'December 2007 Internet Only': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'October 2007 Internet': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'September 2007 Internet': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'August 2007 Lelands - Gaynor': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'November 2007 Catalog': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'June 2007 Lelands - Gaynor': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'May 2007 Lelands - Gaynor': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'July 2007 Lelands - Gaynor': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'April 2007 Lelands - Gaynor': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'April 2007 Catalog': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'March 2007 Lelands - Gaynor': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'February 2007 Lelands - Gaynor': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  '2006 December - St. Louis': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'January 2007 Lelands - Gaynor': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'November 2006 Lelands-Gaynor': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Winter 2006 Catalog': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  '2006 - Barry Bonds': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'October 2006 Lelands-Gaynor': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Summer/August 2006 Catalog': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Spring 2006 Catalog': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'December 2005': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'September 2005 - Sports Collectors\'': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'August 2005 - Sports Collectors\'': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'July 2005 - Fredo': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'June 2005 - Fredo': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'June 2005': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'April 2005 - Fredo': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'March 2005 - Fredo': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'February 2005 - Fredo': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Internet Only (January 2005)': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'December 2004': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'Internet Only (October 2004)': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'June 2004': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'December 2003': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'May 2003': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'December 2002': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'May 2002': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'December 2001': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'August 2001': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'April 2001': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
  'December 2000': { close: null, src: 'listed in the Gallery dropdown (wb:20261004041705/auction.lelands.com/Lots/Gallery); close not found' },
};

const MEMORY_LANE: Record<string, GalleryRow> = {
  'Winter Rarities 2026 Auction': { close: '2026-01-31', src: 'AR "Memory Lane Winter Auction Ends January 31, 2026"' },
  'Summer Rarities Auction 2025': { close: '2025-09-13', src: 'AR "Memory Lane\'s Summer Rarities Auction Ends September 13, 2025"' },
  'Spring Rarities Auction 2025': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Winter Rarities Auction 2025': { close: '2025-01-11', src: 'https://www.auctionreport.com/bid-on-1800-high-end-lots-featured-in-memory-lanes-january-11-2025-auction/' },
  'Summer Rarities Auction 2024': { close: '2024-09-07', src: 'AR "Ruth Bat, Gehrig Rookie Among Memory Lane Summer Headliners Ends Sept. 7, 2024"' },
  'Spring 2024 Rarities Auction': { close: '2024-05-04', src: 'AR "Memory Lane\'s Spring Rarities Auction Ends May 4, 2024"' },
  'Winter Premier 2024 Auction': { close: '2024-02-03', src: 'AR "Bid In Memory Lane\'s Winter Premier Auction Ending Feb. 3, 2024"' },
  'Winter Rarities 2024 Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Summer Rarities Auction 2023': { close: '2023-09-09', src: 'AR "Memory Lane\'s Summer Rarities Auction Ends Sept. 9, 2023"' },
  'Summer 2022 Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Spring Rarities 2022': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Winter Rarities 2022': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Fall Sets & Set Break 2021 Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Fall Rarities Auction 2021': { close: '2021-10-09', src: 'AR "Memory Lane Unveils Huge Fall Rarities Auction with Two Catalog Set – Ends Oct. 9, 2021"' },
  'Spring 2021 Rarities Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Spring Rarities Auction 2020': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Winter Classic 2019': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Sizzling Summer Rarities Auction 2019': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Spring Break Rarities Auction 2019': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Summer Spectacular 2018 Auction': { close: '2018-08-11', src: 'AR "Memory Lane Inc Summer Spectacular In Progress – Ends August 11, 2018"' },
  'Spring Fever Auction 2018': { close: '2018-05-19', src: 'AR "Bid Now In Memory Lane\'s Spring Fever Auction – Ending May 19, 2018"' },
  'Fall Classic 2017 Auction': { close: '2017-10-14', src: 'AR "Memory Lane Inc Fall Classic Auction In Progress – Ends October 14, 2017"' },
  'Sizzling Summer Auction 2017': { close: '2017-08-12', src: 'AR "Memory Lane Inc Sizzling Summer Auction In Progress – Closes August 12, 2017"' },
  'Spring 2017 Holy Grail Rarities Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Winter Rarities Auction 2017': { close: '2017-01-14', src: 'AR "Memory Lane Winter Rarities Auction Bidding Opens Dec. 23rd – Ends January 14, 2017"' },
  'Summer Vintage Rarities 2016': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Spring Classic Rarities Auction 2016': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Summer Break 2015 Auction': { close: '2015-08-15', src: 'AR "Memory Lane\'s Summer Break Auction In Progress – Ends August 15th" (Sat Aug 15 2015)' },
  'Spring Break 2015 Auction': { close: '2015-05-09', src: 'AR "Memory Lane\'s Spring Break Auction Ends May 9"; Sports Collectors Digest Apr 13 2015 "closes May 9"' },
  'Summer Rarities Auction 2014': { close: '2014-08-23', src: 'AR "Memory Lane Inc Summer Auction Features Items From Rocky Mountain Collection – Ends Aug. 23" (Sat Aug 23 2014)' },
  'Spring Break 2014': { close: '2014-05-10', src: 'AR "Bid Now: Memory Lane\'s Spring Break Auction In Progress – Ends May 10th" (Sat May 10 2014)' },
  'SUMMER RARITIES AUCTION 2013': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'THE SPRING BREAK AUCTION 2013': { close: '2013-05-11', src: 'AR "Memory Lane Inc. – Auction in Progress – Ends May 11th" (Sat May 11 2013)' },
  'The Find Winter 2012': { close: '2012-12-15', src: 'AR "Bid Now: Memory Lane\'s The Find Auction Closing December 15th" (Sat Dec 15 2012)' },
  'Historical Rarities Summer 2012 Auction': { close: '2012-08-18', src: 'AR "Memory Lane Inc. Historical Rarities Auction Live – Ends August 18"' },
  'HOLY GRAIL AUCTION SPRING 2012': { close: '2012-05-05', src: 'AR "Memory Lane\'s HOLY GRAIL AUCTION is in Full Swing! Ends Saturday, May 5th"' },
  'WINTER 2011 Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
  'Sizzling SUMMER 2011 Auction': { close: '2011-08-20', src: 'AR "Memory Lanes Auction Ends August 20th Auction – Bid Now" (Sat Aug 20 2011)' },
  'Sizzling Summer 2010 Treasures Auction': { close: '2010-08-14', src: 'AR "Memory Lane Offers Cream of 1952 Topps Crop in Summer Auction Ends Saturday, August 14th"' },
  'Spring 2007 Auction': { close: null, src: 'listed in the Gallery dropdown (wb:20260202062451/bid.memorylaneinc.com/Lots/Gallery); close not found' },
};
export const GALLERY_CLOSE_DATES: Readonly<Record<string, Readonly<Record<string, GalleryRow>>>> = {
  'Love of the Game': LOTG, Lelands: LELANDS, 'Memory Lane': MEMORY_LANE,
};
export const GALLERY_HOUSES: ReadonlySet<string> = new Set(Object.keys(GALLERY_CLOSE_DATES));

/** a dropdown label as the table keys it (LOTG appends " - Closes <date>" while a sale is live) */
export function galleryLabelKey(label: string): string {
  return label.replace(/\s+-\s+closes\b.*$/i, '').replace(/\s+/g, ' ').trim();
}

/** The cited close of a gallery-house sale from its dropdown label, or null. */
export function galleryCloseFor(house: string, label: string | null | undefined, asOf?: string): { date: string; precision: ClosePrecision; src: string } | null {
  const t = GALLERY_CLOSE_DATES[house];
  if (!t || !label) return null;
  const row = t[galleryLabelKey(label)];
  if (!row || !row.close) return null;
  return { date: asOf && row.close > asOf ? asOf : row.close, precision: 'day', src: row.src };
}

/**
 * seasonToDate's mid-month stub for a sale label (the one implementation —
 * sports-crawl.ts seasonToDate delegates here): season word → its month
 * (winter → FEBRUARY), else a month name, else June; day 15. `legacy` = the
 * pre-Aug-2026 mapping that sent winter to DECEMBER of the label year (rows
 * stamped then still carry it).
 */
export function labelStub(label: string, legacy = false): string | null {
  const m = label.match(/(20[0-2]\d)/);
  if (!m) return null;
  const year = m[1];
  const l = label.toLowerCase();
  const winter = legacy ? '12' : '02';
  const mm = /spring/.test(l) ? '04' : /summer/.test(l) ? '07' : /(fall|autumn)/.test(l) ? '10' : /winter/.test(l) ? winter
    : /jan/.test(l) ? '01' : /feb/.test(l) ? '02' : /mar/.test(l) ? '03' : /apr/.test(l) ? '04' : /may/.test(l) ? '05'
    : /jun/.test(l) ? '06' : /jul/.test(l) ? '07' : /aug/.test(l) ? '08' : /sep/.test(l) ? '09' : /oct/.test(l) ? '10'
    : /nov/.test(l) ? '11' : /dec/.test(l) ? '12' : '06';
  return `${year}-${mm}-15`;
}

type StubIndex = { byStub: Map<string, GalleryRow[]>; closes: Set<string> };
const stubIndexCache = new Map<string, StubIndex>();
function stubIndex(house: string): StubIndex | null {
  const t = GALLERY_CLOSE_DATES[house];
  if (!t) return null;
  const hit = stubIndexCache.get(house);
  if (hit) return hit;
  const ix: StubIndex = { byStub: new Map(), closes: new Set() };
  for (const [label, row] of Object.entries(t)) {
    const stubs = new Set([labelStub(label), labelStub(label, true)].filter((x): x is string => !!x));
    stubs.forEach(s => { const a = ix.byStub.get(s) || []; a.push(row); ix.byStub.set(s, a); });
    if (row.close) ix.closes.add(row.close);
  }
  stubIndexCache.set(house, ix);
  return ix;
}

/**
 * Re-date a stored gallery row that carries only its stub (the crawler kept no
 * saleName). Every dropdown label whose stub (current, or the legacy
 * winter→December one) is the row's date is a candidate sale:
 *  · one candidate, cited → that close ('day');
 *  · several, all cited → the LATEST close as a bound ('season'): the row
 *    belongs to one of them and was not known before the last one closed;
 *  · any candidate uncited, or none at all → null (the stub stays).
 * `{ exact: true }` = the date already IS a cited close of this house and no
 * label stubs to it (a live-leg End: day that falls on a 15th): only the
 * 'month' precision stampDatePrecision guessed for it is wrong.
 */
export function galleryStubClose(house: string, saleDate: string, asOf?: string): { date: string; precision: ClosePrecision } | { exact: true } | null {
  const ix = stubIndex(house);
  if (!ix || !/^\d{4}-\d{2}-15$/.test(saleDate)) return null;
  const cands = ix.byStub.get(saleDate);
  if (!cands || !cands.length) return ix.closes.has(saleDate) ? { exact: true } : null;
  if (cands.some(c => !c.close)) return null;
  const closes = Array.from(new Set(cands.map(c => c.close as string))).sort();
  const last = closes[closes.length - 1];
  return { date: asOf && last > asOf ? asOf : last, precision: closes.length === 1 ? 'day' : 'season' };
}
