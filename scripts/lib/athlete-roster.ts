/**
 * athlete-roster.ts — the athletes lectr's own corpus knows (Oct 6 2026,
 * categorization wave 2). An autograph house (RR Auction) and the sports
 * houses' pop desks title a signed piece by the bare name ("Ty Cobb", "Ted
 * Williams and Stan Musial", "Sugar Ray Robinson Signed Photograph"), which no
 * sport-word regex reads: 14k athlete autographs sat in culture.
 *
 * Derivation (scratchpad w2/roster.ts + rost2.py over the Oct 6 corpus): every
 * player the CARD parser (app/lib/cards.ts parseCard) read ≥8 times, name of
 * 2–3 words with no team/set/checklist word (knownPlayerSet's filter), named
 * in ≥20 sports-market titles and in non-sports titles less than 0.3× as
 * often (the athletes whose autographs leaked into culture — Nicklaus, Louis,
 * Dempsey, Palmer… — were kept by hand), minus non-athletes that ride card
 * sets (Marilyn Monroe, Walt Disney, Bruce Lee, presidents) and names shared
 * with famous non-athletes (Joe Jackson, Will Smith, Joe Perry …).
 * 2305 names, lowercase ASCII, single-spaced.
 */
const ROSTER = (
  'aaron clubs|aaron donald|aaron gordon|aaron jones|aaron judge|aaron nesmith|aaron nola|aaron rodgers|' +
  'abe attell|ace bailey|adam comorosky|adam wainwright|addie joss|adley rutschman|admiral schlei|adolfo luque|' +
  'adrian beltre|adrian dantley|adrian peterson|ahmad sauce gardner|aidan hutchinson|aidan miller|ajay mitchell|' +
  'akeem olajuwon|al benton|al brazle|al bridwell|al dark|al demaree|al evans|al horford|al kaline|al lopez|' +
  'al rosen|al simmons|al walker|al zarilla|alan page|alan trammell|albert belle|albert pujols|alec bohm|' +
  'alec pierce|alejandro garnacho|aleksej pokusevski|alessandro del piero|alex bregman|alex english|alex karras|' +
  'alex kellner|alex kirilloff|alex morgan|alex ovechkin|alex rodriguez|alexa bliss|alexander albon|' +
  'alexander ovechkin|alexandre sarr|alexis lafreniere|alfonso soriano|allen iverson|allie reynolds|' +
  'alonzo mourning|alperen sengun|alphonso davies|alvin crowder|alvin dark|alvin kamara|amanda nunes|' +
  'amari cooper|amby mcconnell|amen thompson|amos strunk|andre agassi|andre dawson|andre iguodala|andre johnson|' +
  'andre reed|andrea pirlo|andrei kirilenko|andres gimenez|andres iniesta|andrew benintendi|andrew bynum|' +
  'andrew luck|andrew mccutchen|andrew vaughn|andrew wiggins|andriy shevchenko|andruw jones|andy carey|' +
  'andy pafko|andy pages|andy pettitte|andy seminick|anfernee hardaway|anfernee simons|angel di maria|' +
  'angel reese|ansu fati|antawn jamison|anthony black|anthony davis|anthony edwards|anthony munoz|' +
  'anthony richardson|anthony rizzo|anthony volpe|antoine griezmann|antoine walker|arch manning|archie manning|' +
  'archie wilson|arda guler|aristides aquino|arky vaughan|armando marsans|arnold palmer|aroldis chapman|' +
  'art devlin|art donovan|art fromme|art houtteman|art monk|artis gilmore|ashton jeanty|ausar thompson|' +
  'austin ekeler|austin reaves|austin riley|austin wells|auston matthews|ayo dosunmu|ayrton senna|babe herman|' +
  'babe ruth|babe ruth hits|bailey zappe|baker mayfield|bam adebayo|barney mccosky|baron davis|barry bonds|' +
  'barry larkin|barry sanders|bart starr|beals becker|ben chapman|ben gordon|ben rice|ben roethlisberger|' +
  'ben simmons|ben wade|ben wallace|benjamin sesko|bennedict mathurin|benny bengough|bernie kosar|' +
  'bernie williams|bert blyleven|bert campaneris|bijan robinson|bilal coulibaly|bill belichick|bill bergen|' +
  'bill bradley|bill carrigan|bill dahlen|bill dickey|bill dudley|bill fischer|bill freehan|bill hallahan|' +
  'bill herman|bill jurges|bill laimbeer|bill mazeroski|bill nicholson|bill posedel|bill rigney|bill ripken|' +
  'bill russell|bill serena|bill sharman|bill skowron|bill terry|bill virdon|bill walton|bill white|bill wight|' +
  'billy cox|billy cunningham|billy goodman|billy herman|billy hitchcock|billy hoeft|billy johnson|billy loes|' +
  'billy martin|billy meyer|billy pierce|billy ripken|billy sullivan|billy urbanski|billy wagner|billy williams|' +
  'bing miller|birdie tebbetts|blake griffin|blake snell|blaze jordan|bo bichette|bo jackson|bo nix|bob bescher|' +
  'bob bonner|bob borkowski|bob cain|bob cerv|bob chipman|bob clemente|bob cousy|bob del greco|bob elliott|' +
  'bob feller|bob friend|bob gibson|bob griese|bob grim|bob groom|bob hayes|bob hofman|bob hooper|bob kennedy|' +
  'bob kuzava|bob lanier|bob lemon|bob lilly|bob mcadoo|bob pettit|bob porterfield|bob ramazzotti|bob rush|' +
  'bob schultz|bob skinner|bob swift|bob thorpe|bob turley|bob uecker|bob usher|bob waterfield|bobby adams|' +
  'bobby bell|bobby bonds|bobby charlton|bobby clarke|bobby cox|bobby dalbec|bobby doerr|bobby hull|bobby jones|' +
  'bobby layne|bobby moore|bobby morgan|bobby murcer|bobby orr|bobby richardson|bobby shantz|bobby thomson|' +
  'bobby wallace|bobby witt jr|bol bol|bones hyland|boog powell|boomer esiason|bradley beal|brady house|' +
  'brady singer|branch rickey|brandin podziemski|brandon aiyuk|brandon clarke|brandon ingram|brandon lowe|' +
  'brandon marsh|brandon miller|brandon roy|breanna stewart|brendan mckay|brent barry|bret saberhagen|brett baty|' +
  'brett favre|brett hull|brian dawkins|brian leetch|brian robinson jr|brian thomas jr|brian urlacher|' +
  'brittney griner|brock bowers|brock lesnar|brock purdy|bronko nagurski|bronny james|bronny james jr|brooks lee|' +
  'brooks robinson|bruce edwards|bruce smith|bruce sutter|bruno fernandes|bryan acuna|bryan reynolds|' +
  'bryan trottier|bryce eldridge|bryce harper|bryce young|bryson dechambeau|bryson stott|bub carrington|' +
  'bubba church|buck ewing|buck weaver|bucky dent|bucky harris|bud byerly|buddy hield|buddy myer|bugs raymond|' +
  'bukayo saka|bulldog turner|bump hadley|burleigh grimes|buster posey|byron buxton|byron scott|cade cunningham|' +
  'caitlin clark|cal abrams|cal raleigh|cal ripken|cal ripken jr|cale makar|caleb williams|calvin johnson|' +
  'calvin murphy|calvin ridley|cam akers|cam collier|cam neely|cam newton|cam reddish|cam skattebo|cam ward|' +
  'cam whitmore|cameron brink|cameron johnson|cameron thomas|camilo pascual|carl erskine|carl furillo|' +
  'carl hubbell|carl scheib|carl yastrzemski|carlos alcaraz|carlos beltran|carlos boozer|carlos correa|' +
  'carlos delgado|carlos sainz|carlton fisk|carmelo anthony|carson benge|carson wentz|casey mize|casey stengel|' +
  'cason wallace|cass michaels|cassius clay|catfish hunter|ceddanne rafaela|ceedee lamb|chad johnson|' +
  'champ bailey|channing frye|charles barkley|charles comiskey|charles gehringer|charles herzog|charles leclerc|' +
  'charles oakley|charles oliveira|charles woodson|charley conerly|charley gehringer|charley trippi|' +
  'charlie gehringer|charlie grimm|charlie joiner|charlie keller|charlie silvera|charlie villanueva|chase burns|' +
  'chase claypool|chase delauter|chase young|chauncey billups|chet holmgren|chick gandil|chick hafey|' +
  'chief bender|chief meyers|chipper jones|chris bosh|chris chelios|chris duarte|chris godwin|chris mullin|' +
  'chris olave|chris paul|chris sale|chris webber|christian braun|christian encarnacion strand|' +
  'christian laettner|christian mccaffrey|christian moore|christian okoye|christian pulisic|christian watson|' +
  'christian yelich|christopher morel|christy mathewson|chuba hubbard|chuck bednarik|chuck diering|chuck dressen|' +
  'chuck klein|chuck liddell|chuck stobbs|cj abrams|clark griffith|claude hendrix|clayton kershaw|clem koshorek|' +
  'clem labine|cliff fannin|cliff mapes|clint hartung|clyde drexler|clyde edwards helaire|clyde milan|' +
  'clyde sukeforth|clyde vollmer|coby white|cody bellinger|cole anthony|cole caufield|cole kmet|cole palmer|' +
  'colin kaepernick|collin sexton|colson montgomery|colton cowser|connie hawkins|connie mack|connie marrero|' +
  'connor bedard|connor mcdavid|conor mcgregor|cookie lavagetto|cooper dejean|cooper flagg|cooper kupp|' +
  'corbin carroll|corey maggette|corey seager|courtland sutton|craig biggio|cris carter|cristhian vaquero|' +
  'cristian hernandez|cristian pache|cristiano ronaldo|curt flood|curt schilling|curt simmons|curtis martin|' +
  'curtis mead|cy barger|cy young|dak prescott|dale alexander|dale earnhardt|dale earnhardt jr|dale earnhardt sr|' +
  'dale mitchell|dale murphy|dalton kincaid|dalton knecht|dalvin cook|dameon pierce|damian lillard|' +
  'damon stoudamire|dan fouts|dan hampton|dan marino|daniel jones|daniel ricciardo|danny ainge|danny granger|' +
  'danny murtaugh|dansby swanson|darius garland|darko milicic|darryl dawkins|darryl strawberry|darwin nunez|' +
  'daunte culpepper|davante adams|dave bancroft|dave bing|dave concepcion|dave cowens|dave debusschere|' +
  'dave kingman|dave koslo|dave madison|dave mcnally|dave parker|dave philley|dave winfield|davey williams|' +
  'david beckham|david cone|david justice|david montgomery|david ortiz|david robinson|david thompson|' +
  'david wright|davion mitchell|davis mills|dazzy vance|de aaron fox|de andre hunter|de von achane|deacon jones|' +
  'deandre ayton|deandre hopkins|declan rice|dee fondy|deebo samuel|deion sanders|dejounte murray|del crandall|' +
  'del ennis|del pratt|del rice|del wilber|demar derozan|deni avdija|dennis bergkamp|dennis eckersley|' +
  'dennis johnson|dennis rodman|denny mclain|dereck lively ii|derek carr|derek fisher|derek jeter|derik queen|' +
  'deron williams|derrick henry|derrick rose|derrick thomas|derrick white|deshaun watson|desire doue|' +
  'desmond bane|desmond ridder|detlef schrempf|devin booker|devin hester|devin singletary|devin vassell|' +
  'devonta smith|diana taurasi|dick allen|dick bartell|dick brodowski|dick butkus|dick gernert|dick groat|' +
  'dick hoblitzell|dick kryhoski|dick rozek|dick rudolph|dick sisler|dick williams|didier drogba|dikembe mutombo|' +
  'dillon brooks|diogo jota|diontae johnson|dirk nowitzki|dixie howell|dixie walker|dizzy dean|dk metcalf|' +
  'doak walker|dode paskert|dolph schayes|dom dimaggio|domantas sabonis|dominik hasek|dominique wilkins|' +
  'don drysdale|don hoak|don hutson|don kolloway|don larsen|don mattingly|don maynard|don meredith|don mueller|' +
  'don newcombe|don sutton|don zimmer|donovan clingan|donovan mcnabb|donovan mitchell|dots miller|doug atkins|' +
  'doug flutie|doug harvey|drake london|drake maye|draymond green|drew bledsoe|drew brees|drew lock|drew pearson|' +
  'druw jones|ducky medwick|duke kahanamoku|duke snider|duncan robinson|dusan vlahovic|dustin may|dustin pedroia|' +
  'dusty baker|dusty rhodes|dutch leonard|dwayne haskins|dwayne wade|dwight clark|dwight evans|dwight gooden|' +
  'dwight howard|dwyane wade|dylan carlson|dylan cease|dylan crews|dylan harper|earl averill|earl campbell|' +
  'earl combs|earl harrist|earl monroe|earl moore|earl torgeson|earl weaver|earl whitehill|earle combs|' +
  'early wynn|ebba st claire|ed belfour|ed brandt|ed fitzgerald|ed konetchy|ed kranepool|ed lennox|ed lopat|' +
  'ed mathews|ed reed|ed reulbach|ed rousch|ed walsh|edd roush|eddie cicotte|eddie collins|eddie george|' +
  'eddie jones|eddie joost|eddie kazak|eddie mathews|eddie matthews|eddie miksis|eddie moore|eddie murray|' +
  'eddie pellagrini|eddie plank|eddie robinson|eddie shore|eddie stanky|eddie waitkus|eddie yost|eddie yuhas|' +
  'eden hazard|edgar martinez|edgerrin james|edouard julien|eduardo camavinga|edward cicotte|elgin baylor|' +
  'eli manning|elijah green|elijah moore|ellis kinder|elmer valo|eloy jimenez|elroy hirsch|elston howard|' +
  'elton brand|elvin hayes|emmitt smith|enos slaughter|enzo fernandez|eppa rixey|eric davis|eric dickerson|' +
  'eric lindros|erling haaland|ernie banks|ernie davis|ernie lombardi|ernie stautner|erv dusak|erv palica|' +
  'esteban ocon|ethan allen|ethan salas|evan carter|evan longoria|evan mobley|evgeni malkin|ewell blackwell|' +
  'ezekiel elliott|ezequiel tovar|fabio cannavaro|faye throneberry|federico valverde|felipe alou|felix hernandez|' +
  'fence busters|fergie jenkins|ferguson jenkins|fermin lopez|fernando alonso|fernando mendoza|fernando tatis jr|' +
  'fernando torres|fernando valenzuela|ferris fain|florian wirtz|floyd baker|floyd mayweather jr|floyd vaughan|' +
  'forrest gregg|forrest main|fran tarkenton|francesco totti|franco harris|frank baker|frank baumholtz|' +
  'frank campos|frank chance|frank crosetti|frank demaree|frank frisch|frank gifford|frank hogan|frank howard|' +
  'frank lampard|frank laporte|frank malzone|frank overmire|frank robinson|frank shea|frank thomas|' +
  'frankie frisch|franz beckenbauer|franz wagner|fred biletnikoff|fred clarke|fred fitzsimmons|fred frankhouse|' +
  'fred hatfield|fred hutchinson|fred lindstrom|fred luderus|fred lynn|fred mcgriff|fred merkle|fred schulte|' +
  'fred taylor|fred tenney|freddie freeman|freddie lindstrom|frenkie de jong|fritz ostermueller|gabby hartnett|' +
  'gabby street|gabriel arias|gabriel batistuta|gabriel davis|gabriel martinelli|gabriel moreno|gail goodrich|' +
  'gale sayers|gareth bale|garrett crochet|garrett mitchell|garrett wilson|gary carter|gary payton|' +
  'gary sheffield|gavin lux|gavin sheets|gavvy cravath|gaylord perry|gene conley|gene hermanski|gene sarazen|' +
  'gene tunney|gene woodling|geno smith|george bell|george blaeholder|george blanda|george brett|george crowe|' +
  'george davis|george earnshaw|george foster|george gervin|george gibson|george grantham|george halas|' +
  'george kell|george kelly|george kirby|george kittle|george lombard jr|george mcbride|george mikan|' +
  'george mullen|george mullin|george perring|george pickens|george pipgras|george russell|george shuba|' +
  'george sisler|george spencer|george springer|george stallings|george stirnweiss|george stovall|george suggs|' +
  'george uhle|george walberg|georges st pierre|georges vezina|gerald green|gerald staley|gerrit cole|' +
  'gg jackson ii|giancarlo stanton|gianluigi buffon|giannis antetokounmpo|giant gunners|gil coan|gil hodges|' +
  'gil mcdougald|gilbert arenas|gino marchetti|giorgio chiellini|giovanni carmazzi|giovanni reyna|glen rice|' +
  'glenn myatt|glenn nelson|glenn robinson|gleyber torres|gonzalo higuain|goose goslin|gordie howe|gradey dick|' +
  'grady hatton|graig nettles|granny hamner|grant fuhr|grant hill|grayson rodriguez|greg maddux|grover alexander|' +
  'gunnar henderson|gus bell|gus mancuso|gus niarhos|gus suhr|gus zernial|guy lafleur|hack wilson|' +
  'hakeem olajuwon|hal chase|hal greer|hal gregg|hal jeffcoat|hal newhouser|hal rice|hal smith|hank aaron|' +
  'hank bauer|hank edwards|hank greenberg|hank sauer|hank thompson|hans lobert|hans wagner|hap felsch|' +
  'harmon killebrew|harold baines|harold schumacher|harry agganis|harry brecheen|harry carson|harry coveleski|' +
  'harry heilmann|harry hooper|harry kane|harry krause|harry lord|harry lowrey|harry niles|harry perkowski|' +
  'harry simpson|harry walker|harvey elliott|harvey haddix|harvey kuenn|hasbulla magomedov|hector lopez|' +
  'heinie groh|heinie manush|heinie wagner|heinie zimmerman|hendon hooker|henri richard|henrik lundqvist|' +
  'henry aaron|henry davis|henry johnson|henry ruggs iii|henry thompson|herb pennock|herb score|herman franks|' +
  'herman wehmeier|herschel walker|heston kjerstad|heung min son|hick cady|hideki matsui|hideo nomo|hines ward|' +
  'honus wagner|hooks wiltse|hoot evers|horace ford|horace grant|howie camnitz|howie judson|howie long|' +
  'howie morenz|howie pollet|hoyt wilhelm|hub perdue|hugh critz|hugh jennings|hugh mcelhenny|hughie jennings|' +
  'hulk hogan|hunter greene|ian book|ichiro suzuki|immanuel quickley|ira thomas|irv noren|isaac bruce|' +
  'isaac okoro|isack hadjar|isaiah spiller|isaiah stewart|isiah pacheco|isiah thomas|islam makhachev|' +
  'israel adesanya|ivan delock|ivan rodriguez|ja marr chase|ja morant|jabari smith jr|jac caglianone|jace jung|' +
  'jack barry|jack dempsey|jack eichel|jack grealish|jack ham|jack hughes|jack jensen|jack johnson|jack lambert|' +
  'jack merson|jack morris|jack murray|jack nicklaus|jack quinn|jack russell|jack sikma|jack twyman|' +
  'jack youngblood|jackie jensen|jackie robinson|jackson chourio|jackson holliday|jackson jobe|jackson merrill|' +
  'jacob berry|jacob degrom|jacob eason|jacob misiorowski|jacob wilson|jacques plante|jacy sheldon|jaden hardy|' +
  'jaden ivey|jaden mcdaniels|jadon sancho|jahan dotson|jahmyr gibbs|jaime jaquez jr|jaison chourio|' +
  'jake cronenworth|jake daubert|jake fromm|jake pfeister|jake pitler|jake stahl|jakobi meyers|jalen brunson|' +
  'jalen carter|jalen duren|jalen green|jalen hurts|jalen johnson|jalen reagor|jalen rose|jalen suggs|' +
  'jalen tolbert|jalen williams|jamaal wilkes|jamal lewis|jamal murray|jamal musiala|jameer nelson|' +
  'jameis winston|james cook|james harden|james jeffries|james outman|james rodriguez|james wiseman|james wood|' +
  'james worthy|jameson williams|jarace walker|jared goff|jared mccain|jaren jackson jr|jari kurri|jaromir jagr|' +
  'jarred kelenic|jarren duran|jarrett stidham|jason giambi|jason kelce|jason kidd|jason richardson|jason terry|' +
  'jason williams|jason witten|jasson dominguez|javier baez|javonte williams|jaxon smith njigba|jaxson dart|' +
  'jayden daniels|jayden reed|jaylen brown|jaylen waddle|jaylin williams|jayson tatum|jean beliveau|jeff bagwell|' +
  'jeff gordon|jeremy lin|jeremy pena|jeremy sochan|jerome bettis|jerry coleman|jerry jeudy|jerry koosman|' +
  'jerry lucas|jerry priddy|jerry rice|jerry stackhouse|jerry west|jesse haines|jesse owens|jesus made|' +
  'jett williams|jim abbott|jim bottomley|jim brown|jim bunning|jim busby|jim delsing|jim fridley|jim gilliam|' +
  'jim hearn|jim hegan|jim hunter|jim kaat|jim kelly|jim konstanty|jim lonborg|jim otto|jim palmer|jim perry|' +
  'jim piersall|jim plunkett|jim rice|jim ringo|jim taylor|jim thome|jim thorpe|jim turner|jim wilson|' +
  'jimmie foxx|jimmy archer|jimmy austin|jimmy butler|jimmy dygert|jimmy dykes|jimmy foxx|jimmy garoppolo|' +
  'jimmy lavender|jimmy rollins|jimmy wilson|jj mccarthy|jj wetherholt|jo adell|jo jo white|joao felix|' +
  'joao neves|joe adcock|joe birmingham|joe black|joe burrow|joe collins|joe cronin|joe dimaggio|joe dumars|' +
  'joe flacco|joe frazier|joe garagiola|joe gordon|joe greene|joe haynes|joe judge|joe klecko|joe kuhel|' +
  'joe mauer|joe medwick|joe mixon|joe montana|joe moore|joe morgan|joe namath|joe nuxhall|joe page|joe pepitone|' +
  'joe rossi|joe ryan|joe sakic|joe sewell|joe theismann|joe tinker|joe tipton|joe torre|joe vosmik|joe wood|' +
  'joel embiid|joey bart|joey bosa|joey votto|johan cruyff|john antonelli|john cena|john clarkson|john collins|' +
  'john daly|john elway|john havlicek|john henry|john kerr|john kucab|john mcgraw|john metchie iii|john riggins|' +
  'john smoltz|john stallworth|john stockton|john tavares|john unitas|john wall|john ward|john welch|john wisden|' +
  'johnny antonelli|johnny bench|johnny damon|johnny evers|johnny groth|johnny hopp|johnny kling|' +
  'johnny klippstein|johnny lujack|johnny manziel|johnny mize|johnny moore|johnny pesky|johnny podres|' +
  'johnny sain|johnny schmitz|johnny unitas|johnny vergez|johnny wyrostek|jon jones|jon lester|jonathan india|' +
  'jonathan kuminga|jonathan mejia|jonathan taylor|jonathan toews|jordan addison|jordan clarkson|jordan hawkins|' +
  'jordan lawlar|jordan love|jordan poole|jordan walker|jordan westburg|jorge posada|jose abreu|jose altuve|' +
  'jose canseco|jose fernandez|jose ramirez|josh allen|josh devore|josh donaldson|josh gibson|josh giddey|' +
  'josh green|josh hamilton|josh jacobs|josh jung|josh lowe|joshua baez|josue de paula|jrue holiday|' +
  'juan gonzalez|juan manuel fangio|juan marichal|juan soto|jude bellingham|juju smith schuster|juju watkins|' +
  'julian alvarez|julian edelman|julio jones|julio rodriguez|julius erving|julius peppers|julius randle|' +
  'jung hoo lee|junior caminero|junior seau|justin crawford|justin fields|justin herbert|justin jefferson|' +
  'justin tucker|justin upton|justin verlander|juwan howard|kadarius toney|kai havertz|kamaru usman|' +
  'kareem abdul jabbar|kareem hunt|karim adeyemi|karim benzema|karl anthony towns|karl drews|karl malone|' +
  'karl olson|kawhi leonard|ke bryan hayes|keegan murray|keenan allen|keith hernandez|keith van horn|' +
  'keldon johnson|kellen winslow|ken boyer|ken dryden|ken griffey|ken griffey jr|ken griffey sr|ken heintzelman|' +
  'ken hubbs|ken raffensberger|ken stabler|ken strong|ken wood|kenneth gainwell|kenneth walker iii|' +
  'kenny dalglish|kenny lofton|kenny pickett|keon coleman|kevin alcantara|kevin de bruyne|kevin durant|' +
  'kevin garnett|kevin johnson|kevin love|kevin magnussen|kevin mcgonigle|kevin mchale|kevin porter jr|' +
  'keyonte george|keyshawn johnson|khabib nurmagomedov|khalil mack|khamzat chimaev|khris middleton|ki ki cuyler|' +
  'kid elberfeld|kiki cuyler|kimi antonelli|kimi raikkonen|kirby puckett|kirill kaprizov|kirk cousins|' +
  'kirk gibson|kirk hinrich|kitty bransfield|klay thompson|knute rockne|kobe bryant|kodai senga|kon knueppel|' +
  'konnor griffin|kordell stewart|kris bryant|kris murray|kristaps porzingis|kumar rocker|kurt rambis|' +
  'kurt warner|kyle hamilton|kyle kuzma|kyle lewis|kyle lowry|kyle manzardo|kyle pitts|kyle schwarber|kyle teel|' +
  'kyle trask|kyle tucker|kyler murray|kylian mbappe|kyren williams|kyrie irving|ladainian tomlinson|' +
  'ladd mcconkey|lamar jackson|lamar odom|lamarcus aldridge|lamelo ball|lamine yamal|lance alworth|lance stroll|' +
  'lando norris|landon donovan|larry bird|larry csonka|larry doby|larry doyle|larry fitzgerald|larry hughes|' +
  'larry jansen|larry johnson|larry nance|larry walker|lars nootbaar|latrell sprewell|lauri markkanen|' +
  'lautaro martinez|laviska shenault jr|lawrence butler|lawrence taylor|lazaro montes|lebron james|' +
  'lebron james diamond|lefty gomez|lefty grove|lefty williams|len dawson|lenny moore|lenny wilkens|leo de vries|' +
  'leo durocher|leo kiely|leo nomellini|leon draisaitl|leonard fournette|leroy kelly|les fusselman|lew alcindor|' +
  'lew burdette|lew fonseca|lewis hamilton|liam lawson|lionel messi|lloyd waner|lon warneke|lonnie walker iv|' +
  'lonnie warneke|lonzo ball|lou boudreau|lou brissie|lou brock|lou criger|lou gehrig|lou groza|lou piniella|' +
  'lou whitaker|luc robitaille|luis aparicio|luis arraez|luis figo|luis garcia|luis robert|luis rodriguez|' +
  'luis suarez|luis tiant|luisangel acuna|luka doncic|luka modric|luke appling|luke easter|luke kuechly|' +
  'luke sewell|luke skywalker|luol deng|lynn swann|mac jones|mac mcclung|mackenzie gore|macklin celebrini|' +
  'madison bumgarner|magic johnson|malik nabers|malik willis|managers dream|manny machado|manny ramirez|' +
  'mantle blasts|mantle hits|manu ginobili|manuel neuer|manute bol|marc andre fleury|marcel dionne|marcell ozuna|' +
  'marcelo mayer|marco luciano|marco reus|marco van basten|marcus allen|marcus camby|marcus mariota|' +
  'marcus rashford|marcus smart|mariano rivera|mario andretti|mario lemieux|marion motley|maris blasts|' +
  'mark aguirre|mark belanger|mark fidrych|mark grace|mark jackson|mark koenig|mark mcgwire|mark messier|' +
  'mark teixeira|marques johnson|marquise brown|marshall faulk|marshawn lynch|martin brodeur|martin odegaard|' +
  'marty marion|marty mcmanus|marvin harrison|marvin harrison jr|marvin williams|masataka yoshida|mason mount|' +
  'mason rudolph|masyn winn|matas buzelis|matt batts|matt chapman|matt corral|matt mclain|matt mervis|matt olson|' +
  'matt ryan|matt shaw|matthew stafford|matty beniers|matty mcintyre|maurice cheeks|maurice mcdermott|' +
  'maurice richard|maury wills|max baer|max bishop|max carey|max christie|max clark|max fried|max holloway|' +
  'max muncy|max scherzer|max schmeling|max verstappen|maxx crosby|mays catch makes|mecole hardman jr|mel blount|' +
  'mel ott|mel parnell|mel renfro|mel stottlemyre|mercedes amg petronas|merlin olsen|mia hamm|micah parsons|' +
  'michael ballack|michael busch|michael cooper|michael finley|michael harris|michael harris ii|michael irvin|' +
  'michael jordan|michael olise|michael penix jr|michael phelps|michael pittman jr|michael porter jr|' +
  'michael redd|michael schumacher|michael strahan|michael thomas|michael vick|mick schumacher|mickey cochrane|' +
  'mickey doolan|mickey harris|mickey mantle|mickey vernon|miguel cabrera|miguel vargas|mikal bridges|' +
  'mike alstott|mike bibby|mike bossy|mike ditka|mike evans|mike garcia|mike mitchell|mike modano|mike mussina|' +
  'mike piazza|mike schmidt|mike singletary|mike stanton|mike trout|mike tyson|miller huggins|milt bolling|' +
  'milton stock|minnie minoso|mitch marner|mitch richmond|mo vaughn|moe berg|mohamed salah|monte irvin|' +
  'monte kennedy|mookie betts|mordecai brown|morrie martin|moses malone|moses moody|muddy ruel|muhammad ali|' +
  'muhammed ali|mule haas|munetaka murakami|myles garrett|myles turner|najee harris|nap lajoie|nap rucker|' +
  'napoleon lajoie|nate archibald|nate robinson|nate thurmond|nathan mackinnon|ned garver|nellie fox|nelson fox|' +
  'neymar jr|nicholas latifi|nick bosa|nick chubb|nick gonzales|nick kurtz|nick lodolo|nickeil alexander walker|' +
  'nico collins|nico hischier|nico hoerner|nico hulkenberg|niki lauda|nikola jokic|nikola jovic|nikola vucevic|' +
  'noah syndergaard|noelvi marte|nolan arenado|nolan gorman|nolan ryan|nomar garciaparra|norm cash|' +
  'norm van brocklin|novak djokovic|obi toppin|ochai agbaji|odell beckham jr|oliver bearman|olivier giroud|' +
  'oneil cruz|onyeka okongwu|orel hershiser|orestes minoso|orval overall|oscar charleston|oscar colas|' +
  'oscar melillo|oscar piastri|oscar robertson|oswald bluege|oswald peraza|oswaldo cabrera|otis crandall|' +
  'otto graham|otto knabe|otto miller|ousmane dembele|owen friend|owen wilson|ozzie albies|ozzie newsome|' +
  'ozzie smith|paddy pimblett|paige bueckers|paolo banchero|paolo maldini|pascal siakam|pat freiermuth|pat moran|' +
  'pat mullin|pat riley|pat tillman|patrick ewing|patrick kane|patrick mahomes|patrick mahomes ii|patrick roy|' +
  'patrick surtain ii|patrick williams|pau gasol|paul arizin|paul brown|paul coffey|paul george|paul goldschmidt|' +
  'paul hornung|paul konerko|paul minner|paul molitor|paul pierce|paul pressey|paul richards|paul scholes|' +
  'paul skenes|paul waner|paul warfield|pavel bure|pavel nedved|payne stewart|payton pritchard|peaches graham|' +
  'pedro martinez|pee wee reese|peja stojakovic|pepper martin|pete alonso|pete crow armstrong|pete maravich|' +
  'pete reiser|pete rose|pete runnels|pete sampras|pete suder|peyton manning|peyton watson|phil cavarretta|' +
  'phil esposito|phil foden|phil jackson|phil masi|phil mickelson|phil niekro|phil rizzuto|phil simms|' +
  'philip rivers|pie traynor|pierre emerick aubameyang|pierre gasly|ping bodie|preacher roe|printing plates|' +
  'puka nacua|quentin grimes|rabbit maranville|rafael devers|rafael leao|rafael nadal|rafael palmeiro|' +
  'raheem sterling|rajon rondo|ralph branca|ralph houk|ralph kiner|ralph sampson|randall cunningham|' +
  'randy arozarena|randy jackson|randy johnson|randy moss|randy white|rashee rice|rasheed wallace|rashod bateman|' +
  'raul rosas jr|ray allen|ray benge|ray boone|ray bourque|ray fisher|ray jablonski|ray kremer|ray lewis|' +
  'ray murray|ray nitschke|ray robinson|ray scarborough|ray schalk|raymond berry|raymond felton|red ames|' +
  'red dooin|red faber|red grange|red kleinow|red lucas|red rolfe|red ruffing|red schoendienst|reed sheppard|' +
  'reggie jackson|reggie miller|reggie wayne|reggie white|reid detmers|rhamondre stevenson|rhys hoskins|' +
  'ric flair|ricardo pepi|rich gossage|richard hamilton|richard jefferson|richard petty|richie allen|' +
  'richie ashburn|rick barry|rick ferrell|rickey henderson|ricky pearsall|ricky williams|riggs stephenson|' +
  'rik smits|riley greene|rip repulski|rival fence busters|rj barrett|rob dillingham|rob gronkowski|' +
  'robert griffin iii|robert hassell|robert lewandowski|robert parish|robert williams iii|roberto alomar|' +
  'roberto baggio|roberto carlos|roberto clemente|roberto clemente jr|robin roberts|robin yount|robinson cano|' +
  'rocco colavito|rocky bridges|rocky colavito|rocky marciano|rod carew|rod woodson|roderick arias|' +
  'roger bresnahan|roger clemens|roger craig|roger federer|roger maris|roger peckinpaugh|roger staubach|' +
  'rogers hornsby|roki sasaki|rolando blackman|rollie fingers|rollie zeider|roman anthony|roman reigns|' +
  'rome odunze|romeo doubs|ron artest|ron cey|ron fairly|ron francis|ron guidry|ron mercer|ron santo|' +
  'ronald acuna|ronald acuna jr|ronaldo nazario|ronda rousey|ronnie lott|ronny mauricio|rory mcilroy|' +
  'roy campanella|roy face|roy halladay|roy johnson|roy mcmillan|roy sievers|roy smalley|royce gracie|' +
  'royce lewis|rube benton|rube manning|rube marquard|rube oldring|rube waddell|rube walker|rudy gobert|' +
  'rui hachimura|russ ford|russ meyer|russell westbrook|russell wilson|rusty staub|ryan braun|ryan howard|' +
  'ryan mountcastle|ryan tannehill|ryne sandberg|sabrina ionescu|sadaharu oh|saddiq bey|sadio mane|sal frelick|' +
  'sal maglie|sal yvars|salvador perez|sam byrd|sam chapman|sam crawford|sam darnold|sam ehlinger|sam howell|' +
  'sam huff|sam jethroe|sam jones|sam laporta|sam mcdowell|sam mele|sam perkins|sam rice|sam white|sammy baugh|' +
  'sammy sosa|sammy white|samuel basallo|samuel zavala|sandy alcantara|sandy amoros|sandy koufax|saquon barkley|' +
  'satchel paige|satchell paige|saul rogovin|schoolboy rowe|scoot henderson|scott rolen|scottie barnes|' +
  'scottie pippen|scuderia ferrari|sean murphy|sean taylor|sebastian telfair|sebastian vettel|seiya suzuki|' +
  'serena williams|sergei fedorov|sergino dest|sergio aguero|sergio perez|sergio ramos|shaedon sharpe|' +
  'shai gilgeous alexander|shane baz|shane mcclanahan|shannon sharpe|shareef abdur rahim|shaun alexander|' +
  'shaun livingston|shawn kemp|shawn marion|shedeur sanders|sheldon jones|sherm lollar|sherman lollar|' +
  'sherry magee|sherry robertson|shoeless joe jackson|shohei ohtani|shota imanaga|sibby sisti|sid gordon|' +
  'sid hudson|sid luckman|sidney crosby|sidney moncrief|skyy moore|slim sallee|smoky burgess|smoky joe wood|' +
  'solly hemus|solly hofman|sonny jurgensen|sparky lyle|spencer jones|spencer rattler|spencer strider|' +
  'spencer torkelson|spud webb|stan mikita|stan musial|stan rojek|stanley matthews|stefon diggs|steph curry|' +
  'stephen curry|stephen strasburg|stephon castle|stephon marbury|steve austin|steve carlton|steve francis|' +
  'steve garvey|steve gromek|steve kerr|steve largent|steve mcnair|steve nash|steve smith|steve souchock|' +
  'steve van buren|steve young|steve yzerman|steven gerrard|steven kwan|sue bird|tammy abraham|tari eason|' +
  'tarik skubal|tayshaun prince|ted gray|ted kluszewski|ted lepcio|ted lindsay|ted lyons|ted signs|ted simmons|' +
  'ted wilks|ted williams|tee higgins|teemu selanne|teoscar hernandez|termarr johnson|terrell davis|' +
  'terrell owens|terry bradshaw|terry cummings|terry mclaurin|terry sawchuk|thierry henry|thomas muller|' +
  'thurman munson|thurman thomas|tiger woods|tiki barber|tim anderson|tim brown|tim duncan|tim hardaway|' +
  'tim horton|tim jordan|tim lincecum|tim mccarver|tim raines|tim tebow|timo werner|toby atwell|todd gurley|' +
  'todd helton|tom aspinall|tom brady|tom bridges|tom downey|tom fears|tom glavine|tom gola|tom heinsohn|' +
  'tom landry|tom lasorda|tom morgan|tom seaver|tom tresh|tom zachary|tommy henrich|tommy holmes|tommy john|' +
  'tommy lasorda|tommy leach|tommy mccarthy|toni kroos|toni kukoc|tony bartirome|tony conigliaro|tony cuccinello|' +
  'tony dorsett|tony esposito|tony gonzalez|tony gwynn|tony kubek|tony la russa|tony larussa|tony lazzeri|' +
  'tony oliva|tony parker|tony perez|tony piet|tony romo|torry holt|toto wolff|tracy mcgrady|trae young|' +
  'travis bazzana|travis etienne jr|travis hunter|travis jackson|travis kelce|travon walker|trayce jackson davis|' +
  'tre mann|trea turner|trent alexander arnold|trent grisham|trevon diggs|trevor hoffman|trevor lawrence|' +
  'trevor story|trevor zegras|trey lance|trey mcbride|trey murphy iii|trey sermon|trey sweeney|treylon burks|' +
  'tris speaker|triston casas|troy aikman|troy polamalu|tua tagovailoa|tug mcgraw|turk edwards|turk lown|ty cobb|' +
  'tyler herro|tyler shough|tyler warren|tyreek hill|tyrese haliburton|tyrese maxey|umar nurmagomedov|usain bolt|' +
  'vada pinson|val picinich|valtteri bottas|van jefferson|vaughn grissom|vean gregg|venus williams|vern fleming|' +
  'vern stephens|vernon gomez|vic wertz|vic willis|victor wembanyama|vida blue|vidal brujan|vin baker|' +
  'vince carter|vince dimaggio|vini jr|vinicius jr|vinicius junior|vinnie pasquantino|virgil trucks|' +
  'virgil van dijk|vlade divac|vladimir guerrero|vladimir guerrero jr|vladimir guerrero sr|von miller|wade boggs|' +
  'waite hoyt|walker buehler|walker jenkins|walker kessler|wally moon|wally post|wally westlake|walt alston|' +
  'walt bellamy|walt dropo|walt dubiel|walt frazier|walt masterson|walter alston|walter berger|walter evers|' +
  'walter hagen|walter johnson|walter payton|walter stewart|wan dale robinson|wander franco|ward miller|' +
  'warren giles|warren hacker|warren moon|warren sapp|warren spahn|warren zaire emery|wayne gretzky|wayne rooney|' +
  'wayne terwilliger|wee willie keeler|wes unseld|wes westrum|weston mckennie|whitey ford|whitey herzog|' +
  'whitey lockman|wilbert robinson|wildfire schulte|will clark|will levis|willard marshall|willard nixon|' +
  'willard ramsdell|william harridge|william perry|willie davis|willie horton|willie jones|willie kamm|' +
  'willie mays|willie mccovey|willie randolph|willie stargell|willis hudlin|willis reed|wilmer mizell|' +
  'wilt chamberlain|woody english|wyatt langford|xander bogaerts|xavier legette|xavier tillman|xavier worthy|' +
  'yadier molina|yao ming|yogi berra|yordan alvarez|yoshinobu yamamoto|youssoufa moukoko|yu darvish|yuki tsunoda|' +
  'zac veen|zaccharie risacher|zach edey|zach lavine|zach neto|zach wheat|zach wilson|zack gelof|zack moss|' +
  'zack wheat|zack wheeler|zay flowers|zeke bonura|zhou guanyu|ziaire williams|zinedine zidane|zion williamson|' +
  'zlatan ibrahimovic|' +
  ''
).split('|').filter(Boolean);

// (wave 4) the coaches, boxers, drivers, jockeys and track / tennis greats
// the card parser rarely reads (they print on few cards) but the autograph
// houses title by bare name ("Vince Lombardi Signature", "Floyd Patterson and
// Ingemar Johansson Signed Photograph", "A. J. Foyt Signed Helmet"). Names
// shared with famous non-athletes are left out.
const ROSTER_SUPPLEMENT = (
  'vince lombardi|paul bear bryant|bear bryant|tom landry|don shula|george halas|red auerbach|john wooden|' +
  'phil jackson|pat riley|scotty bowman|joe mccarthy|tony la russa|sparky anderson|tommy lasorda|earl weaver|' +
  'joe torre|bill parcells|chuck noll|mike ditka|joe paterno|dean smith|bobby knight|mike krzyzewski|' +
  'jim valvano|adolph rupp|red holzman|paul brown|curly lambeau|woody hayes|bud grant|hank stram|marv levy|' +
  'joe gibbs|leo durocher|miller huggins|john mcgraw|walter alston|' +
  'floyd patterson|ingemar johansson|rocky marciano|sugar ray robinson|joe louis|jack dempsey|gene tunney|' +
  'muhammad ali|joe frazier|george foreman|sonny liston|larry holmes|mike tyson|evander holyfield|' +
  'jake lamotta|rocky graziano|archie moore|jersey joe walcott|ezzard charles|max schmeling|primo carnera|' +
  'james j braddock|jim braddock|john l sullivan|jim jeffries|bob fitzsimmons|marvin hagler|' +
  'thomas hearns|roberto duran|sugar ray leonard|oscar de la hoya|manny pacquiao|floyd mayweather|willie pep|' +
  'henry armstrong|tony zale|carmen basilio|ken norton|leon spinks|michael spinks|lennox lewis|jack sharkey|' +
  'max baer|gene fullmer|benny leonard|mickey walker|harry greb|stanley ketchel|' +
  'mario andretti|aj foyt|a j foyt|jeff gordon|jimmie johnson|cale yarborough|bobby allison|darrell waltrip|' +
  'junior johnson|al unser|bobby unser|rick mears|emerson fittipaldi|juan manuel fangio|stirling moss|' +
  'jackie stewart|niki lauda|michael schumacher|lewis hamilton|graham hill|phil hill|dan gurney|' +
  'carroll shelby|barney oldfield|danica patrick|tony stewart|kyle busch|max verstappen|' +
  'willie shoemaker|bill shoemaker|eddie arcaro|steve cauthen|' +
  'jesse owens|jim thorpe|babe didrikson|bill tilden|rod laver|arthur ashe|billie jean king|chris evert|' +
  'martina navratilova|bjorn borg|john mcenroe|jimmy connors|serena williams|roger federer|rafael nadal|' +
  'carl lewis|bob mathias|mark spitz|michael phelps|jack nicklaus|ben hogan|sam snead|gene sarazen|' +
  'byron nelson|walter hagen|francis ouimet|tiger woods|gary player|lee trevino|tom watson|' +
  'hulk hogan|ric flair|andre the giant|' +
  ''
).split('|').filter(Boolean);

export const ATHLETES: ReadonlySet<string> = new Set(ROSTER.concat(ROSTER_SUPPLEMENT));

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

/** The first roster athlete a title names (2- or 3-word run), or null.
 *  `maxStart` bounds where the name may begin (word index) — an autograph
 *  title LEADS with its signer ("Ted Williams Signed Photograph"), so a name
 *  deep in the title ("John F. Kennedy … Mentioning Ted Williams") is not it. */
export function athleteIn(title: string | null | undefined, maxStart = Infinity): string | null {
  const raw = String(title || '');
  const hit = athleteInFolded(fold(raw), maxStart);
  if (hit) return hit;
  // (wave 4) a quoted nickname inside the name: George "Highpockets" Kelly,
  // Charles "Old Hoss" Radbourn
  const bare = raw.replace(/\s+["“'‘][A-Za-z .'-]{2,24}["”'’]\s+/g, ' ');
  return bare !== raw ? athleteInFolded(fold(bare), maxStart) : null;
}
function athleteInFolded(folded: string, maxStart: number): string | null {
  const w = folded.split(' ').filter(Boolean);
  for (let i = 0; i < Math.min(w.length - 1, maxStart + 1); i++) {
    if (i + 2 < w.length) { const g3 = `${w[i]} ${w[i + 1]} ${w[i + 2]}`; if (ATHLETES.has(g3)) return g3; }
    const g2 = `${w[i]} ${w[i + 1]}`;
    if (ATHLETES.has(g2)) return g2;
  }
  return null;
}
