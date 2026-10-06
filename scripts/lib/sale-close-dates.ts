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
